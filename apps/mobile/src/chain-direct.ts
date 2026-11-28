import { Buffer } from 'buffer';
import {
  BPS_DENOMINATOR_N,
  computeParticipantClaim,
  computeTier,
  impactBps,
  LAMPORTS_PER_SOL_N,
  maxImpactSol,
  PDA_SEEDS,
  quoteBuy,
  quoteSell,
  u64LeBytes,
  type CallDetail,
  type CallState,
  type CallerRecord,
  type ParticipantPosition,
  type SettleReason,
  type TokenInfo,
} from '@percaya/core';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
export const PERCAYA_PROGRAM_ID = '8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6';
export const PERCAYA_AMM_PROGRAM_ID = 'AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz';
export const GLOBAL_CONFIG_PDA = 'F559AB2MjAZModvfDw9oqqpy8gNEuS3AFYZbFTii8aa7';
const SPL_TOKEN_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const DEVNET_TOKENS_META = [
  {
    symbol: 'tBONK',
    name: 'Testnet Bonk',
    decimals: 6,
    mint: '5Y5uHKfMzJz1VREgJWE8D2vHmxkrTHetzS1uoUebgukR',
    ammPool: 'GgTd1UV5SPntSPfsJVEsWafvMk7EWJyQ6i5YwAsNzuiH',
  },
  {
    symbol: 'tWIF',
    name: 'Testnet dogwifhat',
    decimals: 6,
    mint: 'AVdTeM9FEHiBdnPfZ8hKKknkStTxcLrZNkVSRnQoJLDn',
    ammPool: 'DTE5Ujr19xh982gGN2h67tdMrYGDpxtsTv1eJaSknxmw',
  },
  {
    symbol: 'tSKR',
    name: 'Testnet Seeker Ecosystem',
    decimals: 6,
    mint: 'F1vMDdVFHVwBQBcRW5SgqVHEs8P4ayWTmffhCWBMYyip',
    ammPool: '4XmQwqt8su3HrsSCmtDXx4iXzj3zcMZCkEmdiwUCE4i6',
  },
] as const;

// Precomputed 8-byte Anchor account discriminators (base64): sha256("account:<Name>")[0..8]
const ACC_DISC = {
  AmmPool: 'NlK5irO/06k=',
  CallerRecord: 'm0A1y2Sdos4=',
  Position: 'qryP5HpA99A=',
  CallPool: 'irVIil5JzfU=',
} as const;

// Precomputed 8-byte Anchor instruction discriminators: sha256("global:<name>")[0..8]
const IX_DISC = {
  register_caller: new Uint8Array([41, 1, 139, 167, 235, 41, 118, 21]),
  post_bond: new Uint8Array([168, 151, 202, 119, 163, 58, 147, 247]),
  open_call: new Uint8Array([153, 26, 89, 45, 252, 243, 183, 62]),
  init_position: new Uint8Array([197, 20, 10, 1, 97, 160, 177, 91]),
  deposit: new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]),
  buy: new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
  checkpoint: new Uint8Array([213, 200, 19, 204, 240, 143, 184, 252]),
  sell: new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
  claim: new Uint8Array([62, 198, 214, 193, 213, 159, 108, 210]),
} as const;

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

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return viewOf(bytes).getUint16(offset, true);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return viewOf(bytes).getUint32(offset, true);
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  return viewOf(bytes).getBigUint64(offset, true);
}

function readI64LE(bytes: Uint8Array, offset: number): bigint {
  return viewOf(bytes).getBigInt64(offset, true);
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  return Buffer.from(bytes).toString('utf8');
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  return new Uint8Array(Buffer.from(str, 'utf8'));
}

function concatBytes(...arrays: Uint8Array[]): Buffer {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return Buffer.from(out);
}

function decodeAmmPoolBytes(data: Uint8Array) {
  const tokenMint = new PublicKey(data.subarray(40, 72)).toBase58();
  const tokenVault = new PublicKey(data.subarray(72, 104)).toBase58();
  const tokenDecimals = data[104];
  const feeBps = readU16LE(data, 105);
  const solReserve = readU64LE(data, 107);
  const tokenReserve = readU64LE(data, 115);
  return { tokenMint, tokenVault, tokenDecimals, feeBps, solReserve, tokenReserve };
}

function decodeCallerRecordBytes(data: Uint8Array): CallerRecord {
  const caller = new PublicKey(data.subarray(8, 40)).toBase58();
  const genesisRaw = new PublicKey(data.subarray(40, 72)).toBase58();
  const isSeekerVerified = data[72] === 1;
  const bondLamports = readU64LE(data, 73).toString();
  const withdrawReadyAt = Number(readI64LE(data, 81));
  const settled = readU32LE(data, 89);
  const losses = readU32LE(data, 93);
  const negligent = readU32LE(data, 97);
  const refunded = readU32LE(data, 101);
  const split = readU32LE(data, 105);
  const slashes = readU32LE(data, 109);
  const active = readU32LE(data, 113);
  const lastActive = Number(readI64LE(data, 117));
  const sumNetBps = Number(readI64LE(data, 125));
  const avgNetBps = settled > 0 ? Math.trunc(sumNetBps / settled) : null;
  const genesisMint = genesisRaw === PublicKey.default.toBase58() ? null : genesisRaw;
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

function decodePositionBytes(data: Uint8Array) {
  const callId = Number(readU64LE(data, 8));
  const participant = new PublicKey(data.subarray(16, 48)).toBase58();
  const deposited = readU64LE(data, 48).toString();
  const claimed = data[56] === 1;
  return { callId, participant, deposited, claimed };
}

function decodeCallPoolBytes(
  pda: string,
  data: Uint8Array,
  tokenMap: Map<string, TokenInfo>,
  callerMap: Map<string, CallerRecord>,
  positions: ParticipantPosition[],
): CallDetail {
  const callId = Number(readU64LE(data, 8));
  const caller = new PublicKey(data.subarray(16, 48)).toBase58();
  const tokenMint = new PublicKey(data.subarray(48, 80)).toBase58();
  const openedAt = Number(readI64LE(data, 80));
  const state = CALL_STATES[data[88]] ?? 'Open';
  const settleReason = SETTLE_REASONS[data[89]] ?? 'None';

  let o = 90;
  const ammPool = new PublicKey(data.subarray(o, o + 32)).toBase58();
  o += 32;
  const windowEnd = Number(readI64LE(data, o));
  o += 8;
  const buyDeadline = Number(readI64LE(data, o));
  o += 8;
  const maxHoldSec = readU32LE(data, o);
  o += 4;
  const takeProfitBps = readU32LE(data, o);
  o += 4;
  const stopLossBps = readU16LE(data, o);
  o += 2;
  const shareBps = readU16LE(data, o);
  o += 2;
  const minCallerBps = readU16LE(data, o);
  o += 2;
  const maxImpactBps = readU16LE(data, o);
  o += 2;
  const sellToleranceBps = readU16LE(data, o);
  o += 2;
  const keeperBps = readU16LE(data, o);
  o += 2;
  const checkpointGapSec = readU32LE(data, o);
  o += 4;
  const splitGraceSec = readU32LE(data, o);
  o += 4;
  const capLamports = readU64LE(data, o).toString();
  o += 8;
  const minPoolLamports = readU64LE(data, o).toString();
  o += 8;

  const totalInLamports = readU64LE(data, o).toString();
  o += 8;
  const callerStakeLamports = readU64LE(data, o).toString();
  o += 8;
  const depositorsCount = readU32LE(data, o);
  o += 4;
  const claimsLeft = readU32LE(data, o);
  o += 4;
  const tokensBoughtAtoms = readU64LE(data, o).toString();
  o += 8;
  const boughtAt = Number(readI64LE(data, o));
  o += 8;
  const holdUntil = Number(readI64LE(data, o));
  o += 8;
  const prevCpVal = readU64LE(data, o).toString();
  o += 8;
  const prevCpAt = Number(readI64LE(data, o));
  o += 8;
  const lastCpVal = readU64LE(data, o).toString();
  o += 8;
  const lastCpAt = Number(readI64LE(data, o));
  o += 8;
  const grossOutLamports = readU64LE(data, o).toString();
  o += 8;
  const payoutLamports = readU64LE(data, o).toString();
  o += 8;
  const feeLamports = readU64LE(data, o).toString();
  o += 8;
  const claimedAmount = readU64LE(data, o).toString();
  o += 8;
  const netReturnBpsRaw = Number(readI64LE(data, o));
  o += 8;
  o += 2; // bump + sol_vault_bump
  const thesisLen = readU32LE(data, o);
  o += 4;
  const thesis = decodeUtf8(data.subarray(o, o + thesisLen));

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

/**
 * Reads live `percaya` & `percaya_amm` PDAs directly from Solana Devnet RPC on-device.
 * Ensures any cold-installed APK immediately runs against live Devnet state with zero local server setup.
 */
export async function fetchDevnetStateDirect(rpcUrl = DEVNET_RPC_URL): Promise<{
  calls: CallDetail[];
  callers: CallerRecord[];
  tokens: TokenInfo[];
}> {
  const conn = new Connection(rpcUrl, 'confirmed');
  const percayaPk = new PublicKey(PERCAYA_PROGRAM_ID);
  const ammPk = new PublicKey(PERCAYA_AMM_PROGRAM_ID);

  const metaByMint = new Map<string, (typeof DEVNET_TOKENS_META)[number]>();
  for (const t of DEVNET_TOKENS_META) {
    metaByMint.set(t.mint, t);
  }

  const [ammAccounts, callerAccounts, posAccounts, callAccounts] = await Promise.all([
    conn.getProgramAccounts(ammPk, {
      filters: [{ memcmp: { offset: 0, bytes: ACC_DISC.AmmPool, encoding: 'base64' } }],
    }),
    conn.getProgramAccounts(percayaPk, {
      filters: [{ memcmp: { offset: 0, bytes: ACC_DISC.CallerRecord, encoding: 'base64' } }],
    }),
    conn.getProgramAccounts(percayaPk, {
      filters: [{ memcmp: { offset: 0, bytes: ACC_DISC.Position, encoding: 'base64' } }],
    }),
    conn.getProgramAccounts(percayaPk, {
      filters: [{ memcmp: { offset: 0, bytes: ACC_DISC.CallPool, encoding: 'base64' } }],
    }),
  ]);

  const tokenMap = new Map<string, TokenInfo>();
  for (const acct of ammAccounts) {
    const decoded = decodeAmmPoolBytes(acct.account.data);
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

  const callerMap = new Map<string, CallerRecord>();
  for (const acct of callerAccounts) {
    const rec = decodeCallerRecordBytes(acct.account.data);
    callerMap.set(rec.pubkey, rec);
  }

  const posByCall = new Map<number, ParticipantPosition[]>();
  for (const acct of posAccounts) {
    const p = decodePositionBytes(acct.account.data);
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

  const calls: CallDetail[] = [];
  for (const acct of callAccounts) {
    const raw = acct.account.data;
    const callId = Number(readU64LE(raw, 8));
    const callerPk = new PublicKey(raw.subarray(16, 48)).toBase58();
    const positions = (posByCall.get(callId) ?? []).map((p) => ({
      ...p,
      isCaller: p.participant === callerPk,
    }));
    calls.push(decodeCallPoolBytes(acct.pubkey.toBase58(), raw, tokenMap, callerMap, positions));
  }

  calls.sort((a, b) => b.openedAt - a.openedAt || b.callId - a.callId);
  const callers = Array.from(callerMap.values()).sort((a, b) => b.lastActive - a.lastActive);
  const tokens = Array.from(tokenMap.values());

  return { calls, callers, tokens };
}

async function compileV0Base64(
  conn: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

function encodeOpenCallData(args: {
  windowDuration: number;
  takeProfitBps: number;
  stopLossBps: number;
  maxHoldDuration: number;
  shareBps: number;
  stakeLamports: bigint;
  thesis: string;
}): Buffer {
  const thesisBytes = encodeUtf8(args.thesis);
  if (thesisBytes.length > 280) {
    throw new Error('Thesis exceeds 280 UTF-8 bytes');
  }
  const fixed = new Uint8Array(4 + 4 + 2 + 4 + 2 + 8 + 4);
  const dv = viewOf(fixed);
  let o = 0;
  dv.setUint32(o, args.windowDuration, true);
  o += 4;
  dv.setUint32(o, args.takeProfitBps, true);
  o += 4;
  dv.setUint16(o, args.stopLossBps, true);
  o += 2;
  dv.setUint32(o, args.maxHoldDuration, true);
  o += 4;
  dv.setUint16(o, args.shareBps, true);
  o += 2;
  dv.setBigUint64(o, args.stakeLamports, true);
  o += 8;
  dv.setUint32(o, thesisBytes.length, true);

  return concatBytes(IX_DISC.open_call, fixed, thesisBytes);
}

/**
 * Builds an atomic Open Call transaction directly on-device (`register_caller` + `post_bond` + `open_call`).
 */
export async function buildOpenCallTxDirect(params: {
  callerBase58: string;
  tokenSymbol: string;
  stakeSol: number;
  windowMin: number;
  tpPct: number;
  slPct: number;
  maxHoldMin: number;
  sharePct: number;
  thesis: string;
  rpcUrl?: string;
}) {
  const tok = DEVNET_TOKENS_META.find(
    (t) => t.symbol.toLowerCase() === params.tokenSymbol.toLowerCase(),
  );
  if (!tok) throw new Error(`Token $${params.tokenSymbol} not registered on Devnet`);

  const conn = new Connection(params.rpcUrl ?? DEVNET_RPC_URL, 'confirmed');
  const programId = new PublicKey(PERCAYA_PROGRAM_ID);
  const caller = new PublicKey(params.callerBase58);
  const configPda = new PublicKey(GLOBAL_CONFIG_PDA);

  const cfgAcct = await conn.getAccountInfo(configPda);
  if (!cfgAcct) throw new Error('GlobalConfig PDA not found on Solana Devnet');
  const nextCallId = Number(readU64LE(cfgAcct.data, 136));
  const minBondLamports = readU64LE(cfgAcct.data, 146);

  const [callerRecord] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.caller(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const [bondVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.bondVault(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  const ixs: TransactionInstruction[] = [];
  const recAcct = await conn.getAccountInfo(callerRecord);
  let bondNeededLamports = 0n;

  if (!recAcct) {
    bondNeededLamports = minBondLamports;
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: caller, isSigner: true, isWritable: true },
          { pubkey: callerRecord, isSigner: false, isWritable: true },
          { pubkey: bondVault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(IX_DISC.register_caller),
      }),
    );
  } else {
    const currentBond = readU64LE(recAcct.data, 73);
    if (currentBond < minBondLamports) {
      bondNeededLamports = minBondLamports - currentBond;
    }
  }

  if (bondNeededLamports > 0n) {
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: caller, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: callerRecord, isSigner: false, isWritable: true },
          { pubkey: bondVault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: concatBytes(IX_DISC.post_bond, u64LeBytes(bondNeededLamports)),
      }),
    );
  }

  const stakeLamports = BigInt(Math.floor(params.stakeSol * Number(LAMPORTS_PER_SOL_N)));
  if (stakeLamports <= 0n) throw new Error('Stake must be > 0 SOL');

  const [allowedToken] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.allowedToken(new PublicKey(tok.mint).toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const [callPool] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.call(nextCallId).map((b) => Buffer.from(b)),
    programId,
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(nextCallId).map((b) => Buffer.from(b)),
    programId,
  );
  const [callerPos] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.position(nextCallId, caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  ixs.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: caller, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: callerRecord, isSigner: false, isWritable: true },
        { pubkey: allowedToken, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(tok.ammPool), isSigner: false, isWritable: false },
        { pubkey: callPool, isSigner: false, isWritable: true },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: callerPos, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeOpenCallData({
        windowDuration: Math.max(60, Math.round(params.windowMin * 60)),
        takeProfitBps: Math.max(0, Math.round(params.tpPct * 100)),
        stopLossBps: Math.min(9000, Math.max(100, Math.round(params.slPct * 100))),
        maxHoldDuration: Math.max(120, Math.round(params.maxHoldMin * 60)),
        shareBps: Math.min(500, Math.max(0, Math.round(params.sharePct * 100))),
        stakeLamports,
        thesis: params.thesis.slice(0, 280),
      }),
    }),
  );

  const transaction = await compileV0Base64(conn, caller, ixs);
  return {
    transaction,
    callId: nextCallId,
    bondLamports: bondNeededLamports.toString(),
  };
}

/**
 * Builds a Join Pool (`init_position` + `deposit`) transaction directly on-device.
 */
export async function buildDepositTxDirect(params: {
  call: CallDetail;
  accountBase58: string;
  amountSol: number;
  rpcUrl?: string;
}): Promise<{ transaction: string }> {
  const { call, accountBase58, amountSol } = params;
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error('Deposit amount must be greater than 0 SOL');
  }
  const lamports = BigInt(Math.floor(amountSol * Number(LAMPORTS_PER_SOL_N)));
  if (lamports <= 0n) throw new Error('Deposit amount in lamports must be positive');

  const newTotal = BigInt(call.totalInLamports) + lamports;
  if (newTotal > BigInt(call.rules.capLamports)) {
    throw new Error('Deposit exceeds caller bond tier cap');
  }
  const callerStake =
    accountBase58 === call.caller
      ? BigInt(call.callerStakeLamports) + lamports
      : BigInt(call.callerStakeLamports);

  if (callerStake * BPS_DENOMINATOR_N < newTotal * BigInt(call.rules.minCallerBps)) {
    throw new Error('Deposit would dilute caller below minimum 5% pool share');
  }

  const impact = impactBps(
    BigInt(call.token.solReserveLamports),
    newTotal,
    BigInt(call.token.feeBps),
  );
  if (impact > call.rules.maxImpactBps) {
    throw new Error(`Pool buy price impact (${(impact / 100).toFixed(2)}%) exceeds 2.00% limit`);
  }

  const conn = new Connection(params.rpcUrl ?? DEVNET_RPC_URL, 'confirmed');
  const participant = new PublicKey(accountBase58);
  const programId = new PublicKey(PERCAYA_PROGRAM_ID);

  const [callPoolPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.call(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.position(call.callId, participant.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const ammPoolKey = new PublicKey(call.rules.ammPool);

  const ixs: TransactionInstruction[] = [];
  const posAcct = await conn.getAccountInfo(positionPda);
  if (!posAcct) {
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: participant, isSigner: true, isWritable: true },
          { pubkey: callPoolPda, isSigner: false, isWritable: false },
          { pubkey: positionPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(IX_DISC.init_position),
      }),
    );
  }

  ixs.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: participant, isSigner: true, isWritable: true },
        { pubkey: callPoolPda, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: ammPoolKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concatBytes(IX_DISC.deposit, u64LeBytes(lamports)),
    }),
  );

  return { transaction: await compileV0Base64(conn, participant, ixs) };
}

/**
 * Builds `buy`, `checkpoint`, `sell`, or `claim` transactions directly on-device.
 */
export async function buildPoolActionTxDirect(params: {
  action: 'buy' | 'checkpoint' | 'sell' | 'claim';
  signerBase58: string;
  call: CallDetail;
  rpcUrl?: string;
}): Promise<{ transaction: string }> {
  const { action, signerBase58, call } = params;
  const conn = new Connection(params.rpcUrl ?? DEVNET_RPC_URL, 'confirmed');
  const programId = new PublicKey(PERCAYA_PROGRAM_ID);
  const ammPk = new PublicKey(PERCAYA_AMM_PROGRAM_ID);
  const signer = new PublicKey(signerBase58);
  const callPool = new PublicKey(call.pda);

  if (action === 'buy') {
    const tokenMint = new PublicKey(call.token.mint);
    const ammPool = new PublicKey(call.rules.ammPool);
    const ammInfo = await conn.getAccountInfo(ammPool);
    if (!ammInfo) throw new Error('AmmPool not found on Devnet');
    const decodedAmm = decodeAmmPoolBytes(ammInfo.data);
    const ammTokenVault = new PublicKey(decodedAmm.tokenVault);

    const [solVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
      programId,
    );
    const [allowedToken] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.allowedToken(tokenMint.toBytes()).map((b) => Buffer.from(b)),
      programId,
    );
    const [ammSolVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
      ammPk,
    );
    const [callTokenVault] = PublicKey.findProgramAddressSync(
      [callPool.toBuffer(), SPL_TOKEN_ID.toBuffer(), tokenMint.toBuffer()],
      ATA_PROGRAM_ID,
    );

    const expectedOut = quoteBuy(
      decodedAmm.solReserve,
      decodedAmm.tokenReserve,
      BigInt(call.totalInLamports),
      BigInt(decodedAmm.feeBps),
    );
    const minTokensOut = (expectedOut * 9_800n) / BPS_DENOMINATOR_N; // 2% slippage guard

    const createAtaIx = new TransactionInstruction({
      programId: ATA_PROGRAM_ID,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: callTokenVault, isSigner: false, isWritable: true },
        { pubkey: callPool, isSigner: false, isWritable: false },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    });

    const buyIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: callPool, isSigner: false, isWritable: true },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: allowedToken, isSigner: false, isWritable: false },
        { pubkey: ammPool, isSigner: false, isWritable: true },
        { pubkey: ammSolVault, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: ammTokenVault, isSigner: false, isWritable: true },
        { pubkey: callTokenVault, isSigner: false, isWritable: true },
        { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
        { pubkey: ammPk, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concatBytes(IX_DISC.buy, u64LeBytes(minTokensOut)),
    });

    return { transaction: await compileV0Base64(conn, signer, [createAtaIx, buyIx]) };
  }

  if (action === 'checkpoint') {
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: callPool, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(call.rules.ammPool), isSigner: false, isWritable: false },
      ],
      data: Buffer.from(IX_DISC.checkpoint),
    });
    return { transaction: await compileV0Base64(conn, signer, [ix]) };
  }

  if (action === 'sell') {
    const ammPool = new PublicKey(call.rules.ammPool);
    const tokAccts = await conn.getTokenAccountsByOwner(callPool, {
      mint: new PublicKey(call.token.mint),
    });
    if (tokAccts.value.length === 0) {
      throw new Error('Call token vault not found on chain');
    }
    const callTokenVault = tokAccts.value[0].pubkey;
    const ammInfo = await conn.getAccountInfo(ammPool);
    if (!ammInfo) throw new Error('AmmPool not found on Devnet');
    const ammTokenVault = new PublicKey(ammInfo.data.subarray(72, 104));

    const [solVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
      programId,
    );
    const [callerRecord] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.caller(new PublicKey(call.caller).toBytes()).map((b) => Buffer.from(b)),
      programId,
    );
    const [ammSolVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
      ammPk,
    );

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
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
      data: Buffer.from(IX_DISC.sell),
    });
    return { transaction: await compileV0Base64(conn, signer, [ix]) };
  }

  // claim
  const [solVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [position] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.position(call.callId, signer.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: callPool, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(call.token.mint), isSigner: false, isWritable: false },
      { pubkey: callPool, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(IX_DISC.claim),
  });
  return { transaction: await compileV0Base64(conn, signer, [ix]) };
}
