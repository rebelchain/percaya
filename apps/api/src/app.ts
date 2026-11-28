import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CallState } from '@percaya/core';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import {
  ACTIONS_CORS_HEADERS,
  buildActionMetadata,
  buildBlinkDepositTransaction,
  renderCallCardSvg,
} from './actions.ts';
import { getProgramIds } from './chain.ts';
import {
  createSiwsChallenge,
  signSessionToken,
  verifySessionToken,
  verifySiwsLogin,
} from './siws.ts';
import { createPercayaStore, type PercayaStore } from './store.ts';
import {
  buildBuyTx,
  buildCheckpointTx,
  buildClaimTx,
  buildOpenCallTx,
  buildSellTx,
  buildVerifySeekerGenesisTx,
} from './tx-builders.ts';

export function createApp(customStore?: PercayaStore) {
  const mode = process.env.DATA === 'chain' ? 'chain' : 'demo';
  const store = customStore ?? createPercayaStore(mode);
  const siwsSecret = process.env.SIWS_SECRET || 'percaya-dev-secret-change-in-prod';
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

  const app = new Hono();

  app.use('*', cors());

  function requireAuth(authHeader: string | undefined): string | null {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return verifySessionToken(authHeader.slice(7), siwsSecret);
  }

  // Android App Links Digital Asset Links verification for native Seeker APK deep-linking
  app.get('/.well-known/assetlinks.json', (c) => {
    return c.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.percaya.seeker',
          sha256_cert_fingerprints: [
            process.env.ANDROID_CERT_SHA256 ||
              '8B:86:97:08:80:19:6D:E8:7D:90:50:FF:77:9A:0B:56:ED:9C:CE:A3:1C:68:0D:2F:CE:34:C3:2D:24:DF:25:CB',
          ],
        },
      },
    ]);
  });

  // Solana Actions / Blinks discovery file
  app.options('/actions.json', (c) => c.body(null, 204, ACTIONS_CORS_HEADERS));
  app.get('/actions.json', (c) => {
    return c.json(
      {
        rules: [
          { pathPattern: '/c/*', apiPath: '/api/actions/call/*' },
          { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
        ],
      },
      200,
      ACTIONS_CORS_HEADERS,
    );
  });

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      service: 'percaya-api',
      mode: store.mode,
      cluster: process.env.CLUSTER || 'devnet',
      programs: getProgramIds(),
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

  app.get('/api/config', (c) => {
    return c.json({
      ...store.getConfig(),
      programs: getProgramIds(),
      cluster: process.env.CLUSTER || 'devnet',
    });
  });

  app.get('/api/calls', (c) => {
    const state = c.req.query('state') as CallState | undefined;
    const tokenSymbol = c.req.query('token');
    const caller = c.req.query('caller');
    return c.json({
      calls: store.listCalls({ state, tokenSymbol, caller }),
      ordering: 'newest_first_no_ranking',
    });
  });

  app.get('/api/calls/:id', (c) => {
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    return c.json({ call });
  });

  app.get('/api/calls/:id/replies', (c) => {
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    return c.json({ replies: store.listReplies(id) });
  });

  app.post('/api/calls/:id/replies', async (c) => {
    const user = requireAuth(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Sign in via Seed Vault (SIWS) to reply' }, 401);
    const id = Number(c.req.param('id'));
    const { body } = await c.req.json<{ body: string }>();
    if (!body || !body.trim()) return c.json({ error: 'Reply body required' }, 400);
    const reply = store.addReply(id, user, body);
    if (!reply) return c.json({ error: 'Call not found' }, 404);
    return c.json({ reply }, 201);
  });

  app.get('/api/calls/:id/card.svg', (c) => {
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) return c.text('Not found', 404);
    return c.body(renderCallCardSvg(call), 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=10',
    });
  });

  app.get('/api/callers', (c) => {
    return c.json({
      callers: store.listCallers(),
      ordering: 'last_active_no_ranking',
    });
  });

  app.get('/api/callers/:pubkey', (c) => {
    const pubkey = c.req.param('pubkey');
    const caller = store.getCaller(pubkey);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    const history = store.listCalls({ caller: caller.pubkey });
    return c.json({ caller, calls: history });
  });

  // Sign-In With Solana (SIWS) over MWA 2.0
  app.get('/api/auth/nonce', (c) => {
    const address = c.req.query('address');
    const domain = new URL(process.env.PUBLIC_WEB_URL || 'https://percaya.app').host;
    return c.json(createSiwsChallenge(domain, address));
  });

  app.post('/api/auth/verify', async (c) => {
    const body = await c.req.json<{
      pubkey: string;
      message: string;
      signatureBase64: string;
    }>();
    if (!body?.pubkey || !body?.message || !body?.signatureBase64) {
      return c.json({ error: 'Missing SIWS parameters' }, 400);
    }
    const valid = verifySiwsLogin(body);
    if (!valid) {
      return c.json({ error: 'Invalid SIWS Ed25519 signature or expired nonce' }, 401);
    }
    const token = signSessionToken(body.pubkey, siwsSecret);
    return c.json({
      token,
      pubkey: body.pubkey,
      subscriptions: store.getSubscriptions(body.pubkey),
    });
  });

  app.post('/api/me/follow', async (c) => {
    const user = requireAuth(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { caller } = await c.req.json<{ caller: string }>();
    if (!caller) return c.json({ error: 'Missing caller pubkey' }, 400);
    return c.json(store.toggleFollow(user, caller));
  });

  app.post('/api/me/watch', async (c) => {
    const user = requireAuth(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { callId } = await c.req.json<{ callId: number }>();
    if (!callId) return c.json({ error: 'Missing callId' }, 400);
    return c.json(store.toggleWatch(user, Number(callId)));
  });

  app.get('/api/me/alerts', (c) => {
    const user = requireAuth(c.req.header('Authorization'));
    return c.json({ alerts: store.listAlerts(user ?? undefined) });
  });

  app.get('/api/me/stream', (c) => {
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = store.onAlert((alert) => {
        if (!open) return;
        void stream.writeSSE({
          event: 'alert',
          data: JSON.stringify(alert),
          id: alert.id,
        });
      });
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ok: true }) });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      while (open) {
        await stream.sleep(15_000);
        if (open) {
          await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        }
      }
    });
  });

  // Solana Actions (Blinks) endpoints
  app.options('/api/actions/call/:id', (c) => c.body(null, 204, ACTIONS_CORS_HEADERS));

  app.get('/api/actions/call/:id', (c) => {
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) {
      return c.json({ message: 'Call pool not found' }, 404, ACTIONS_CORS_HEADERS);
    }
    const baseUrl = process.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    return c.json(buildActionMetadata(call, baseUrl), 200, ACTIONS_CORS_HEADERS);
  });

  app.post('/api/actions/call/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) {
      return c.json({ message: 'Call pool not found' }, 404, ACTIONS_CORS_HEADERS);
    }
    try {
      const body = await c.req.json<{ account: string }>();
      if (!body?.account) {
        return c.json({ message: 'Missing Solana wallet account' }, 400, ACTIONS_CORS_HEADERS);
      }
      const amountParam = c.req.query('amount') || '0.1';
      const amountSol = Number(amountParam);
      const { transactionBase64, message } = await buildBlinkDepositTransaction({
        call,
        accountBase58: body.account,
        amountSol,
        rpcUrl,
      });
      return c.json(
        {
          type: 'transaction',
          transaction: transactionBase64,
          message,
        },
        200,
        ACTIONS_CORS_HEADERS,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to build deposit transaction';
      return c.json({ message: msg }, 400, ACTIONS_CORS_HEADERS);
    }
  });

  // Mobile MWA 2.0 Devnet Transaction Builders
  app.post('/api/tx/open-call', async (c) => {
    try {
      const body = await c.req.json<{
        caller: string;
        tokenSymbol: string;
        stakeSol: number;
        windowMin: number;
        tpPct: number;
        slPct: number;
        maxHoldMin: number;
        sharePct: number;
        thesis: string;
      }>();
      const res = await buildOpenCallTx({
        rpcUrl,
        callerBase58: body.caller,
        tokenSymbol: body.tokenSymbol,
        stakeSol: Number(body.stakeSol),
        windowMin: Number(body.windowMin),
        tpPct: Number(body.tpPct),
        slPct: Number(body.slPct),
        maxHoldMin: Number(body.maxHoldMin),
        sharePct: Number(body.sharePct),
        thesis: body.thesis || '',
      });
      return c.json(res);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to build open-call tx' },
        400,
      );
    }
  });

  app.post('/api/tx/:action/:id', async (c) => {
    const action = c.req.param('action');
    const id = Number(c.req.param('id'));
    const call = store.getCall(id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    try {
      const { account } = await c.req.json<{ account: string }>();
      if (!account) return c.json({ error: 'Missing account pubkey' }, 400);
      if (action === 'buy') {
        return c.json(await buildBuyTx(rpcUrl, account, call));
      }
      if (action === 'checkpoint') {
        return c.json(await buildCheckpointTx(rpcUrl, account, call));
      }
      if (action === 'sell') {
        return c.json(await buildSellTx(rpcUrl, account, call));
      }
      if (action === 'claim') {
        return c.json(await buildClaimTx(rpcUrl, account, call));
      }
      return c.json({ error: `Unsupported action: ${action}` }, 400);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : `Failed to build ${action} tx` },
        400,
      );
    }
  });

  // Rate-limited Judge Devnet Micro-Faucet (0.15 SOL / wallet / 5m) for 0-SOL Fake Wallet / Seeker testing
  const faucetHistory = new Map<string, number>();
  const FAUCET_COOLDOWN_MS = 5 * 60 * 1000;
  const FAUCET_DRIP_LAMPORTS = 150_000_000; // 0.15 SOL (covers SGT + 0.05 bond + 0.01 stake + headroom)

  app.post('/api/faucet', async (c) => {
    try {
      const body = await c.req.json<{ pubkey?: string }>();
      if (!body?.pubkey) {
        return c.json({ error: 'Missing wallet pubkey' }, 400);
      }
      let recipient: PublicKey;
      try {
        recipient = new PublicKey(body.pubkey);
      } catch {
        return c.json({ error: 'Invalid Solana public key' }, 400);
      }

      const key = recipient.toBase58();
      const lastDrip = faucetHistory.get(key) ?? 0;
      if (Date.now() - lastDrip < FAUCET_COOLDOWN_MS) {
        return c.json({ error: 'Wallet already funded recently on Devnet (5m cooldown)' }, 429);
      }

      const conn = new Connection(rpcUrl, 'confirmed');
      let signer: Keypair | null = null;
      try {
        if (process.env.KEEPER_SECRET_KEY) {
          signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.KEEPER_SECRET_KEY)));
        } else {
          const kpPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
          if (fs.existsSync(kpPath)) {
            signer = Keypair.fromSecretKey(
              Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))),
            );
          }
        }
      } catch {
        signer = null;
      }

      if (signer) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: recipient,
            lamports: FAUCET_DRIP_LAMPORTS,
          }),
        );
        const signature = await sendAndConfirmTransaction(conn, tx, [signer], {
          commitment: 'confirmed',
        });
        faucetHistory.set(key, Date.now());
        return c.json({
          ok: true,
          signature,
          amountSol: FAUCET_DRIP_LAMPORTS / LAMPORTS_PER_SOL,
          source: 'devnet-faucet',
        });
      }

      const signature = await conn.requestAirdrop(recipient, FAUCET_DRIP_LAMPORTS);
      faucetHistory.set(key, Date.now());
      return c.json({
        ok: true,
        signature,
        amountSol: FAUCET_DRIP_LAMPORTS / LAMPORTS_PER_SOL,
        source: 'rpc-airdrop',
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Devnet faucet unavailable' },
        500,
      );
    }
  });

  // Issues a 1-per-wallet Devnet Token-2022 NonTransferable Seeker Genesis NFT + verify_seeker_genesis tx
  const sgtIssuedHistory = new Set<string>();
  app.post('/api/devnet/issue-sgt', async (c) => {
    try {
      const body = await c.req.json<{ caller?: string }>();
      if (!body?.caller) {
        return c.json({ error: 'Missing caller wallet pubkey' }, 400);
      }
      let callerPk: PublicKey;
      try {
        callerPk = new PublicKey(body.caller);
      } catch {
        return c.json({ error: 'Invalid Solana public key' }, 400);
      }

      let authority: Keypair | null = null;
      try {
        if (process.env.KEEPER_SECRET_KEY) {
          authority = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(process.env.KEEPER_SECRET_KEY)),
          );
        } else {
          const kpPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
          if (fs.existsSync(kpPath)) {
            authority = Keypair.fromSecretKey(
              Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))),
            );
          }
        }
      } catch {
        authority = null;
      }

      if (!authority) {
        return c.json({ error: 'Devnet Genesis authority keypair not configured on server' }, 503);
      }

      const res = await buildVerifySeekerGenesisTx({
        rpcUrl,
        callerBase58: callerPk.toBase58(),
        genesisAuthority: authority,
      });
      sgtIssuedHistory.add(callerPk.toBase58());
      return c.json(res);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Unable to build Seeker Genesis tx' },
        400,
      );
    }
  });

  return app;
}
