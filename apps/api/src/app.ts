import type { CallState } from '@percaya/core';
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
              'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
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

  return app;
}
