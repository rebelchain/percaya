import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeParticipantClaim,
  computeTier,
  evaluateSellRule,
  maxImpactSol,
  PDA_SEEDS,
  quoteSell,
  type CallDetail,
  type CallState,
  type CallerRecord,
  type ParticipantPosition,
  type SettleReason,
  type TokenInfo,
} from '@percaya/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  anchorAccountDiscriminator,
  encodeCheckpointIxData,
  encodeRefundIxData,
  encodeSellIxData,
  encodeSplitIxData,
  getProgramIds,
} from './chain.ts';
import type { PercayaStore } from './store.ts';

const SPL_TOKEN_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

interface DevnetTokenMeta {
  symbol: string;
  name: string;
  decimals: number;
  mint: string;
  ammPool: string;
  ammSolVault: string;
  ammTokenVault: string;
}

interface DevnetDeploymentFile {
  rpcUrl: string;
  admin: string;
  programs: { percaya: string; percayaAmm: string };
  tokens: DevnetTokenMeta[];
}

const CALL_STATES: CallState[] = ['Open', 'Holding', 'Settled', 'Refunded', 'Split'];
const SETTLE_REASONS: SettleReason[] = [
  'None',
  'TakeProfit',
  'StopLoss',
  'MaxHold',
  'MinPoolRefund',
  'DeadlineRefund',
  'Split',
];

export function loadDevnetDeployment(): DevnetDeploymentFile | null {
  const candidates = [
    path.resolve('packages/core/src/devnet-deployment.json'),
    path.resolve('../../packages/core/src/devnet-deployment.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as DevnetDeploymentFile;
    }
  }
  return null;
}

export function decodeAmmPool(data: Buffer) {
  const tokenMint = new PublicKey(data.subarray(40, 72)).toBase58();
  const tokenVault = new PublicKey(data.subarray(72, 104)).toBase58();
  const tokenDecimals = data.readUInt8(104);
  const feeBps = data.readUInt16LE(105);
  const solReserve = data.readBigUInt64LE(107);
  const tokenReserve = data.readBigUInt64LE(115);
  return { tokenMint, tokenVault, tokenDecimals, feeBps, solReserve, tokenReserve };
}

export function decodeCallerRecord(data: Buffer): CallerRecord {
  const caller = new PublicKey(data.subarray(8, 40)).toBase58();
  const genesisRaw = new PublicKey(data.subarray(40, 72)).toBase58();
  const isSeekerVerified = data.readUInt8(72) === 1;
  const bondLamports = data.readBigUInt64LE(73).toString();
  const withdrawReadyAt = Number(data.readBigInt64LE(81));
  const settled = data.readUInt32LE(89);
  const losses = data.readUInt32LE(93);
  const negligent = data.readUInt32LE(97);
  const refunded = data.readUInt32LE(101);
  const split = data.readUInt32LE(105);
  const slashes = data.readUInt32LE(109);
  const active = data.readUInt32LE(113);
  const lastActive = Number(data.readBigInt64LE(117));
  const sumNetBps = Number(data.readBigInt64LE(125));
  const avgNetBps = settled > 0 ? Math.trunc(sumNetBps / settled) : null;
  const genesisMint =
    genesisRaw === PublicKey.default.toBase58() ? null : genesisRaw;
  const tierInfo = computeTier(
    { settled, slashes, sumNetBps, isSeekerVerified },
    slashes > 0 && isSeekerVerified,
  );
  return {
    pubkey: caller,
    skrName: isSeekerVerified ? `${caller.slice(0, 4).toLowerCase()}.skr` : null,
    genesisMint,
    isSeekerVerified,
    genesisSlashed: slashes > 0 && isSeekerVerified,
    bondLamports,
    withdrawReadyAt,
    settled,
    losses,
    negligent,
    refunded,
    split,
    slashes,
    active,
    lastActive,
    sumNetBps,
    avgNetBps,
    tierInfo,
    slashHistory: [],
  };
}

export function decodePosition(data: Buffer) {
  const callId = Number(data.readBigUInt64LE(8));
  const participant = new PublicKey(data.subarray(16, 48)).toBase58();
  const deposited = data.readBigUInt64LE(48).toString();
  const claimed = data.readUInt8(56) === 1;
  return { callId, participant, deposited, claimed };
}

export function decodeCallPool(
  pda: string,
  data: Buffer,
  tokenMap: Map<string, TokenInfo>,
  callerMap: Map<string, CallerRecord>,
  positions: ParticipantPosition[],
): CallDetail {
  const callId = Number(data.readBigUInt64LE(8));
  const caller = new PublicKey(data.subarray(16, 48)).toBase58();
  const tokenMint = new PublicKey(data.subarray(48, 80)).toBase58();
  const openedAt = Number(data.readBigInt64LE(80));
  const state = CALL_STATES[data.readUInt8(88)] ?? 'Open';
  const settleReason = SETTLE_REASONS[data.readUInt8(89)] ?? 'None';

  let o = 90;
  const ammPool = new PublicKey(data.subarray(o, o + 32)).toBase58();
  o += 32;
  const windowEnd = Number(data.readBigInt64LE(o));
  o += 8;
  const buyDeadline = Number(data.readBigInt64LE(o));
  o += 8;
  const maxHoldSec = data.readUInt32LE(o);
  o += 4;
  const takeProfitBps = data.readUInt32LE(o);
  o += 4;
  const stopLossBps = data.readUInt16LE(o);
  o += 2;
  const shareBps = data.readUInt16LE(o);
  o += 2;
  const minCallerBps = data.readUInt16LE(o);
  o += 2;
  const maxImpactBps = data.readUInt16LE(o);
  o += 2;
  const sellToleranceBps = data.readUInt16LE(o);
  o += 2;
  const keeperBps = data.readUInt16LE(o);
  o += 2;
  const checkpointGapSec = data.readUInt32LE(o);
  o += 4;
  const splitGraceSec = data.readUInt32LE(o);
  o += 4;
  const capLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const minPoolLamports = data.readBigUInt64LE(o).toString();
  o += 8;

  const totalInLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const callerStakeLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const depositorsCount = data.readUInt32LE(o);
  o += 4;
  const claimsLeft = data.readUInt32LE(o);
  o += 4;
  const tokensBoughtAtoms = data.readBigUInt64LE(o).toString();
  o += 8;
  const boughtAt = Number(data.readBigInt64LE(o));
  o += 8;
  const holdUntil = Number(data.readBigInt64LE(o));
  o += 8;
  const prevCpVal = data.readBigUInt64LE(o).toString();
  o += 8;
  const prevCpAt = Number(data.readBigInt64LE(o));
  o += 8;
  const lastCpVal = data.readBigUInt64LE(o).toString();
  o += 8;
  const lastCpAt = Number(data.readBigInt64LE(o));
  o += 8;
  const grossOutLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const payoutLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const feeLamports = data.readBigUInt64LE(o).toString();
  o += 8;
  const claimedAmount = data.readBigUInt64LE(o).toString();
  o += 8;
  const netReturnBpsRaw = Number(data.readBigInt64LE(o));
  o += 8;
  o += 2; // bump + sol_vault_bump
  const thesisLen = data.readUInt32LE(o);
  o += 4;
  const thesis = data.subarray(o, o + thesisLen).toString('utf8');

  const token: TokenInfo = tokenMap.get(tokenMint) ?? {
    mint: tokenMint,
    symbol: tokenMint.slice(0, 4),
    name: 'SPL Token',
    decimals: 6,
    ammPool,
    allowed: true,
    solReserveLamports: '1000000000',
    tokenReserveAtoms: '1000000000000',
    feeBps: 30,
  };

  const callerRec = callerMap.get(caller);
  const impactCap = maxImpactSol(
    BigInt(token.solReserveLamports),
    BigInt(maxImpactBps),
    BigInt(token.feeBps),
  );
  const bondCap = BigInt(capLamports);
  const liveCapLamports = (impactCap < bondCap ? impactCap : bondCap).toString();

  let liveQuoteLamports: string | null = null;
  let liveQuoteNetBps: number | null = null;
  if (state === 'Holding' && BigInt(tokensBoughtAtoms) > 0n) {
    const q = quoteSell(
      BigInt(token.solReserveLamports),
      BigInt(token.tokenReserveAtoms),
      BigInt(tokensBoughtAtoms),
      BigInt(token.feeBps),
    );
    liveQuoteLamports = q.toString();
    const totalInN = BigInt(totalInLamports);
    if (totalInN > 0n) {
      liveQuoteNetBps = Number(((q - totalInN) * 10_000n) / totalInN);
    }
  }

  const hydratedPositions = positions.map((pos) => ({
    ...pos,
    claimableAmount: computeParticipantClaim(BigInt(pos.depositedLamports), pos.isCaller, {
      state,
      totalInLamports,
      payoutLamports,
      feeLamports,
      tokensBoughtAtoms,
      claimedAmount,
      claimsLeft,
    }).toString(),
  }));

  return {
    callId,
    pda,
    caller,
    callerSkr: callerRec?.skrName ?? null,
    callerSeekerVerified: callerRec?.isSeekerVerified ?? false,
    callerTier: callerRec?.tierInfo.tier ?? 0,
    callerSettled: callerRec?.settled ?? 0,
    callerLosses: callerRec?.losses ?? 0,
    callerAvgNetBps: callerRec?.avgNetBps ?? null,
    token,
    state,
    settleReason,
    openedAt,
    boughtAt,
    holdUntil,
    rules: {
      ammPool,
      windowEnd,
      buyDeadline,
      maxHoldSec,
      takeProfitBps,
      stopLossBps,
      shareBps,
      minCallerBps,
      maxImpactBps,
      sellToleranceBps,
      keeperBps,
      checkpointGapSec,
      splitGraceSec,
      capLamports,
      minPoolLamports,
    },
    totalInLamports,
    callerStakeLamports,
    liveCapLamports,
    depositorsCount,
    claimsLeft,
    tokensBoughtAtoms,
    prevCheckpoint: { valueLamports: prevCpVal, at: prevCpAt },
    lastCheckpoint: { valueLamports: lastCpVal, at: lastCpAt },
    liveQuoteLamports,
    liveQuoteNetBps,
    grossOutLamports,
    payoutLamports,
    feeLamports,
    claimedAmount,
    netReturnBps: state === 'Settled' ? netReturnBpsRaw : null,
    thesis,
    positions: hydratedPositions,
    earlyBuyers: [],
    priceSeries: [],
    replies: [],
    buyTxSig: null,
    sellTxSig: null,
  };
}

function loadKeeperKeypair(): Keypair | null {
  try {
    if (process.env.KEEPER_SECRET_KEY) {
      const parsed = JSON.parse(process.env.KEEPER_SECRET_KEY) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
    const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
    if (fs.existsSync(defaultPath)) {
      const parsed = JSON.parse(fs.readFileSync(defaultPath, 'utf8')) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
  } catch {
    return null;
  }
  return null;
}

export async function syncDevnetOnce(store: PercayaStore, rpcUrl: string): Promise<{
  syncedCalls: number;
  syncedCallers: number;
  syncedTokens: number;
}> {
  const deployment = loadDevnetDeployment();
  const { percayaProgramId, ammProgramId } = getProgramIds();
  const percayaPk = new PublicKey(percayaProgramId);
  const ammPk = new PublicKey(ammProgramId);
  const conn = new Connection(rpcUrl, 'confirmed');

  const metaByMint = new Map<string, DevnetTokenMeta>();
  for (const t of deployment?.tokens ?? []) {
    metaByMint.set(t.mint, t);
  }

  // 1. Fetch live AmmPools
  const ammDisc = anchorAccountDiscriminator('AmmPool').toString('base64');
  const ammAccounts = await conn.getProgramAccounts(ammPk, {
    filters: [{ memcmp: { offset: 0, bytes: ammDisc, encoding: 'base64' } }],
  });
  const tokenMap = new Map<string, TokenInfo>();
  for (const acct of ammAccounts) {
    const decoded = decodeAmmPool(acct.account.data);
    const meta = metaByMint.get(decoded.tokenMint);
    tokenMap.set(decoded.tokenMint, {
      mint: decoded.tokenMint,
      symbol: meta?.symbol ?? decoded.tokenMint.slice(0, 4),
      name: meta?.name ?? 'Devnet SPL Token',
      decimals: decoded.tokenDecimals,
      ammPool: acct.pubkey.toBase58(),
      allowed: true,
      solReserveLamports: decoded.solReserve.toString(),
      tokenReserveAtoms: decoded.tokenReserve.toString(),
      feeBps: decoded.feeBps,
    });
  }

  // 2. Fetch live CallerRecords
  const callerDisc = anchorAccountDiscriminator('CallerRecord').toString('base64');
  const callerAccounts = await conn.getProgramAccounts(percayaPk, {
    filters: [{ memcmp: { offset: 0, bytes: callerDisc, encoding: 'base64' } }],
  });
  const callerMap = new Map<string, CallerRecord>();
  for (const acct of callerAccounts) {
    const rec = decodeCallerRecord(acct.account.data);
    callerMap.set(rec.pubkey, rec);
  }

  // 3. Fetch live Positions
  const posDisc = anchorAccountDiscriminator('Position').toString('base64');
  const posAccounts = await conn.getProgramAccounts(percayaPk, {
    filters: [{ memcmp: { offset: 0, bytes: posDisc, encoding: 'base64' } }],
  });
  const posByCall = new Map<number, ParticipantPosition[]>();
  for (const acct of posAccounts) {
    const p = decodePosition(acct.account.data);
    const list = posByCall.get(p.callId) ?? [];
    list.push({
      callId: p.callId,
      participant: p.participant,
      skrName: callerMap.get(p.participant)?.skrName ?? null,
      depositedLamports: p.deposited,
      claimed: p.claimed,
      claimableAmount: '0',
      isCaller: false,
    });
    posByCall.set(p.callId, list);
  }

  // 4. Fetch live CallPools
  const callDisc = anchorAccountDiscriminator('CallPool').toString('base64');
  const callAccounts = await conn.getProgramAccounts(percayaPk, {
    filters: [{ memcmp: { offset: 0, bytes: callDisc, encoding: 'base64' } }],
  });
  const liveCalls: CallDetail[] = [];
  for (const acct of callAccounts) {
    const callId = Number(acct.account.data.readBigUInt64LE(8));
    const callerPk = new PublicKey(acct.account.data.subarray(16, 48)).toBase58();
    const positions = (posByCall.get(callId) ?? []).map((p) => ({
      ...p,
      isCaller: p.participant === callerPk,
    }));
    liveCalls.push(decodeCallPool(acct.pubkey.toBase58(), acct.account.data, tokenMap, callerMap, positions));
  }

  store.replaceChainState({
    tokens: Array.from(tokenMap.values()),
    callers: Array.from(callerMap.values()),
    calls: liveCalls,
  });

  // 5. Run Auto-Keeper (simulate -> send) if keeper keypair is available
  const keeper = loadKeeperKeypair();
  if (keeper && liveCalls.length > 0) {
    await runKeeperCycle(conn, keeper, percayaPk, ammPk, liveCalls);
  }

  return {
    syncedCalls: liveCalls.length,
    syncedCallers: callerMap.size,
    syncedTokens: tokenMap.size,
  };
}

async function runKeeperCycle(
  conn: Connection,
  keeper: Keypair,
  percayaPk: PublicKey,
  ammPk: PublicKey,
  calls: CallDetail[],
) {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const call of calls) {
    try {
      const callPool = new PublicKey(call.pda);
      const ammPool = new PublicKey(call.rules.ammPool);

      if (call.state === 'Holding') {
        const evalRes = evaluateSellRule({
          nowSec,
          totalInLamports: BigInt(call.totalInLamports),
          prevValue: BigInt(call.prevCheckpoint.valueLamports),
          prevAt: call.prevCheckpoint.at,
          lastValue: BigInt(call.lastCheckpoint.valueLamports),
          lastAt: call.lastCheckpoint.at,
          holdUntil: call.holdUntil,
          checkpointGapSec: call.rules.checkpointGapSec,
          takeProfitBps: call.rules.takeProfitBps,
          stopLossBps: call.rules.stopLossBps,
          sellToleranceBps: call.rules.sellToleranceBps,
        });

        // 1. Trigger permissionless checkpoint() if gap elapsed
        if (
          !evalRes.canSell &&
          (call.lastCheckpoint.at === 0 ||
            nowSec >= call.lastCheckpoint.at + call.rules.checkpointGapSec)
        ) {
          const ix = new TransactionInstruction({
            programId: percayaPk,
            keys: [
              { pubkey: callPool, isSigner: false, isWritable: true },
              { pubkey: ammPool, isSigner: false, isWritable: false },
            ],
            data: encodeCheckpointIxData(),
          });
          await simulateAndSend(conn, keeper, [ix], `checkpoint(#${call.callId})`);
        } else if (nowSec > call.holdUntil + call.rules.splitGraceSec) {
          const [callerRecord] = PublicKey.findProgramAddressSync(
            PDA_SEEDS.caller(new PublicKey(call.caller).toBytes()).map((b) => Buffer.from(b)),
            percayaPk,
          );
          const ix = new TransactionInstruction({
            programId: percayaPk,
            keys: [
              { pubkey: callPool, isSigner: false, isWritable: true },
              { pubkey: callerRecord, isSigner: false, isWritable: true },
            ],
            data: encodeSplitIxData(),
          });
          await simulateAndSend(conn, keeper, [ix], `split(#${call.callId})`);
        } else if (evalRes.canSell) {
          // sell() requires call_token_vault; discover via getTokenAccountsByOwner
          const tokAccts = await conn.getTokenAccountsByOwner(callPool, {
            mint: new PublicKey(call.token.mint),
          });
          if (tokAccts.value.length > 0) {
            const callTokenVault = tokAccts.value[0].pubkey;
            const [solVault] = PublicKey.findProgramAddressSync(
              PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
              percayaPk,
            );
            const [callerRecord] = PublicKey.findProgramAddressSync(
              PDA_SEEDS.caller(new PublicKey(call.caller).toBytes()).map((b) => Buffer.from(b)),
              percayaPk,
            );
            const [ammSolVault] = PublicKey.findProgramAddressSync(
              PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
              ammPk,
            );
            const ammInfo = await conn.getAccountInfo(ammPool);
            if (ammInfo) {
              const ammTokenVault = new PublicKey(ammInfo.data.subarray(72, 104));
              const ix = new TransactionInstruction({
                programId: percayaPk,
                keys: [
                  { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
                  { pubkey: callPool, isSigner: false, isWritable: true },
                  { pubkey: solVault, isSigner: false, isWritable: true },
                  { pubkey: callerRecord, isSigner: false, isWritable: true },
                  { pubkey: ammPool, isSigner: false, isWritable: true },
                  { pubkey: ammSolVault, isSigner: false, isWritable: true },
                  { pubkey: new PublicKey(call.token.mint), isSigner: false, isWritable: false },
                  { pubkey: ammTokenVault, isSigner: false, isWritable: true },
                  { pubkey: callTokenVault, isSigner: false, isWritable: true },
                  { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
                  { pubkey: ammPk, isSigner: false, isWritable: false },
                  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                data: encodeSellIxData(),
              });
              await simulateAndSend(conn, keeper, [ix], `sell(#${call.callId} ${evalRes.reason})`);
            }
          }
        }
      } else if (call.state === 'Open') {
        const underMin =
          nowSec >= call.rules.windowEnd &&
          BigInt(call.totalInLamports) < BigInt(call.rules.minPoolLamports);
        const pastDeadline = nowSec > call.rules.buyDeadline;
        if (underMin || pastDeadline) {
          const [callerRecord] = PublicKey.findProgramAddressSync(
            PDA_SEEDS.caller(new PublicKey(call.caller).toBytes()).map((b) => Buffer.from(b)),
            percayaPk,
          );
          const [allowedToken] = PublicKey.findProgramAddressSync(
            PDA_SEEDS.allowedToken(new PublicKey(call.token.mint).toBytes()).map((b) =>
              Buffer.from(b),
            ),
            percayaPk,
          );
          const ix = new TransactionInstruction({
            programId: percayaPk,
            keys: [
              { pubkey: callPool, isSigner: false, isWritable: true },
              { pubkey: callerRecord, isSigner: false, isWritable: true },
              { pubkey: allowedToken, isSigner: false, isWritable: false },
            ],
            data: encodeRefundIxData(),
          });
          await simulateAndSend(conn, keeper, [ix], `refund(#${call.callId})`);
        }
      }
    } catch (err) {
      console.warn(`[keeper] skipped call #${call.callId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function simulateAndSend(
  conn: Connection,
  keeper: Keypair,
  ixs: TransactionInstruction[],
  label: string,
) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([keeper]);
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) return;
  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(`[keeper] executed ${label} · tx: ${sig}`);
}

export function startDevnetSyncLoop(store: PercayaStore, rpcUrl: string, intervalMs = 15_000) {
  const run = async () => {
    try {
      const stats = await syncDevnetOnce(store, rpcUrl);
      console.log(
        `[devnet-sync] calls=${stats.syncedCalls} callers=${stats.syncedCallers} tokens=${stats.syncedTokens}`,
      );
    } catch (err) {
      console.warn('[devnet-sync] poll error:', err instanceof Error ? err.message : err);
    }
  };
  void run();
  return setInterval(() => void run(), intervalMs);
}
