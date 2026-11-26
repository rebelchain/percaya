import {
  BPS_DENOMINATOR_N,
  LAMPORTS_PER_SOL_N,
  type CallSummary,
  type CallerRecord,
  type SettleReason,
  type TierInfo,
} from './types.ts';

/**
 * Exact constant-product buy quote: floor((R_tok * sol_in * (10000 - fee)) / (R_sol * 10000 + sol_in * (10000 - fee)))
 */
export function quoteBuy(
  solReserveLamports: bigint,
  tokenReserveAtoms: bigint,
  solInLamports: bigint,
  feeBps: bigint = 30n,
): bigint {
  if (solInLamports <= 0n || solReserveLamports <= 0n || tokenReserveAtoms <= 0n) return 0n;
  const netIn = solInLamports * (BPS_DENOMINATOR_N - feeBps);
  const numerator = tokenReserveAtoms * netIn;
  const denominator = solReserveLamports * BPS_DENOMINATOR_N + netIn;
  return numerator / denominator;
}

/**
 * Exact constant-product sell quote: floor((R_sol * tok_in * (10000 - fee)) / (R_tok * 10000 + tok_in * (10000 - fee)))
 */
export function quoteSell(
  solReserveLamports: bigint,
  tokenReserveAtoms: bigint,
  tokenInAtoms: bigint,
  feeBps: bigint = 30n,
): bigint {
  if (tokenInAtoms <= 0n || solReserveLamports <= 0n || tokenReserveAtoms <= 0n) return 0n;
  const netIn = tokenInAtoms * (BPS_DENOMINATOR_N - feeBps);
  const numerator = solReserveLamports * netIn;
  const denominator = tokenReserveAtoms * BPS_DENOMINATOR_N + netIn;
  return numerator / denominator;
}

/**
 * Closed-form price impact in basis points (ceiling) without probe discretization error:
 * ceil((net_in * 10000) / (R_sol * 10000 + net_in))
 */
export function impactBps(
  solReserveLamports: bigint,
  solInLamports: bigint,
  feeBps: bigint = 30n,
): number {
  if (solInLamports <= 0n) return 0;
  if (solReserveLamports <= 0n) return 10_000;
  const netIn = solInLamports * (BPS_DENOMINATOR_N - feeBps);
  const num = netIn * BPS_DENOMINATOR_N;
  const den = solReserveLamports * BPS_DENOMINATOR_N + netIn;
  const ceilBps = (num + den - 1n) / den;
  return Number(ceilBps);
}

/**
 * Closed-form O(1) maximum SOL input whose buy impact stays <= maxImpactBps:
 * floor((R_sol * maxImpactBps * 10000) / ((10000 - maxImpactBps) * (10000 - feeBps)))
 */
export function maxImpactSol(
  solReserveLamports: bigint,
  maxImpactBps: bigint = 200n,
  feeBps: bigint = 30n,
): bigint {
  if (solReserveLamports <= 0n || maxImpactBps <= 0n || maxImpactBps >= BPS_DENOMINATOR_N) {
    return 0n;
  }
  const num = solReserveLamports * maxImpactBps * BPS_DENOMINATOR_N;
  const den = (BPS_DENOMINATOR_N - maxImpactBps) * (BPS_DENOMINATOR_N - feeBps);
  return num / den;
}

/**
 * Computes live Caller Tier (0..3), enforcing Seeker Genesis hardware link for Tiers 1-3.
 */
export function computeTier(
  record: Pick<CallerRecord, 'settled' | 'slashes' | 'sumNetBps' | 'isSeekerVerified'>,
  genesisSlashed = false,
): TierInfo {
  if (record.slashes > 0 || genesisSlashed) {
    return {
      tier: 0,
      bondMultiple: 2,
      maxShareBps: 500,
      reason: 'Slashed record — permanently locked at Tier 0',
    };
  }
  if (!record.isSeekerVerified) {
    return {
      tier: 0,
      bondMultiple: 2,
      maxShareBps: 500,
      reason: 'Unverified wallet — link Seeker Genesis Token to unlock Tiers 1–3',
    };
  }
  if (record.settled < 3) {
    return {
      tier: 0,
      bondMultiple: 2,
      maxShareBps: 500,
      reason: `${record.settled}/3 settled calls required for Tier 1`,
    };
  }
  if (record.sumNetBps <= 0) {
    return {
      tier: 0,
      bondMultiple: 2,
      maxShareBps: 500,
      reason: 'Non-positive average net return — capped at Tier 0',
    };
  }
  if (record.settled >= 25) {
    return {
      tier: 3,
      bondMultiple: 20,
      maxShareBps: 2000,
      reason: '25+ settled calls with positive net return & Seeker Genesis',
    };
  }
  if (record.settled >= 10) {
    return {
      tier: 2,
      bondMultiple: 10,
      maxShareBps: 1500,
      reason: '10+ settled calls with positive net return & Seeker Genesis',
    };
  }
  return {
    tier: 1,
    bondMultiple: 5,
    maxShareBps: 1000,
    reason: '3+ settled calls with positive net return & Seeker Genesis',
  };
}

export interface SettlementBreakdown {
  keeperRewardLamports: bigint;
  netLamports: bigint;
  profitLamports: bigint;
  feeLamports: bigint;
  payoutLamports: bigint;
  netReturnBps: number;
}

/**
 * Exact integer settlement matching Anchor `sell` instruction to the single lamport.
 */
export function computeSettlement(
  totalInLamports: bigint,
  grossOutLamports: bigint,
  shareBps: bigint,
  keeperBps: bigint = 10n,
): SettlementBreakdown {
  const keeperRewardLamports = (grossOutLamports * keeperBps) / BPS_DENOMINATOR_N;
  const netLamports = grossOutLamports - keeperRewardLamports;
  const profitLamports = netLamports > totalInLamports ? netLamports - totalInLamports : 0n;
  const feeLamports = (profitLamports * shareBps) / BPS_DENOMINATOR_N;
  const payoutLamports = netLamports - feeLamports;
  const diff = payoutLamports - totalInLamports;
  const netReturnBps = Number((diff * BPS_DENOMINATOR_N) / totalInLamports);

  return {
    keeperRewardLamports,
    netLamports,
    profitLamports,
    feeLamports,
    payoutLamports,
    netReturnBps,
  };
}

/**
 * Evaluates whether two checkpoints satisfy a sell rule right now.
 */
export function evaluateSellRule(params: {
  nowSec: number;
  totalInLamports: bigint;
  prevValue: bigint;
  prevAt: number;
  lastValue: bigint;
  lastAt: number;
  holdUntil: number;
  checkpointGapSec: number;
  takeProfitBps: number;
  stopLossBps: number;
  sellToleranceBps: number;
}): { canSell: boolean; reason: SettleReason; minOutLamports: bigint } {
  const {
    nowSec,
    totalInLamports,
    prevValue,
    prevAt,
    lastValue,
    lastAt,
    holdUntil,
    checkpointGapSec,
    takeProfitBps,
    stopLossBps,
    sellToleranceBps,
  } = params;

  if (prevAt === 0 || lastAt === 0) {
    return { canSell: false, reason: 'None', minOutLamports: 0n };
  }
  if (lastAt - prevAt < checkpointGapSec || nowSec - lastAt > checkpointGapSec) {
    return { canSell: false, reason: 'None', minOutLamports: 0n };
  }

  const lower = prevValue < lastValue ? prevValue : lastValue;
  const minOutLamports =
    (lower * (BPS_DENOMINATOR_N - BigInt(sellToleranceBps))) / BPS_DENOMINATOR_N;

  if (takeProfitBps > 0) {
    const tpTarget =
      (totalInLamports * (BPS_DENOMINATOR_N + BigInt(takeProfitBps))) / BPS_DENOMINATOR_N;
    if (prevValue >= tpTarget && lastValue >= tpTarget) {
      return { canSell: true, reason: 'TakeProfit', minOutLamports };
    }
  }

  const slFloor =
    (totalInLamports * (BPS_DENOMINATOR_N - BigInt(stopLossBps))) / BPS_DENOMINATOR_N;
  if (prevValue <= slFloor && lastValue <= slFloor) {
    return { canSell: true, reason: 'StopLoss', minOutLamports };
  }

  if (nowSec >= holdUntil) {
    const higher = prevValue > lastValue ? prevValue : lastValue;
    const diff = higher - lower;
    const maxDiff = (higher * BigInt(sellToleranceBps)) / BPS_DENOMINATOR_N;
    if (diff <= maxDiff) {
      return { canSell: true, reason: 'MaxHold', minOutLamports };
    }
  }

  return { canSell: false, reason: 'None', minOutLamports: 0n };
}

/**
 * Computes exact participant claim with final-claimer dust sweep.
 */
export function computeParticipantClaim(
  depositedLamports: bigint,
  isCaller: boolean,
  call: Pick<
    CallSummary,
    | 'state'
    | 'totalInLamports'
    | 'payoutLamports'
    | 'feeLamports'
    | 'tokensBoughtAtoms'
    | 'claimedAmount'
    | 'claimsLeft'
  >,
): bigint {
  if (depositedLamports <= 0n) return 0n;
  const totalIn = BigInt(call.totalInLamports);
  const claimedSoFar = BigInt(call.claimedAmount);

  if (call.state === 'Refunded') {
    return depositedLamports;
  }

  if (call.state === 'Settled') {
    const payout = BigInt(call.payoutLamports);
    const proRata =
      call.claimsLeft === 1 ? payout - claimedSoFar : (payout * depositedLamports) / totalIn;
    const fee = isCaller ? BigInt(call.feeLamports) : 0n;
    return proRata + fee;
  }

  if (call.state === 'Split') {
    const tokens = BigInt(call.tokensBoughtAtoms);
    return call.claimsLeft === 1 ? tokens - claimedSoFar : (tokens * depositedLamports) / totalIn;
  }

  return 0n;
}

/**
 * Rounds SOL amounts strictly DOWN (floor), never up, per design.md rules.
 */
export function formatSolFloor(lamportsInput: bigint | string | number, decimals = 4): string {
  const lamports = BigInt(lamportsInput);
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const factor = 10n ** BigInt(9 - decimals);
  const scaled = abs / factor;
  const whole = scaled / 10n ** BigInt(decimals);
  const frac = (scaled % 10n ** BigInt(decimals)).toString().padStart(decimals, '0');
  const trimmed = frac.replace(/0+$/, '');
  const sign = neg ? '−' : '';
  return trimmed.length > 0
    ? `${sign}${whole.toLocaleString('en-US')}.${trimmed}`
    : `${sign}${whole.toLocaleString('en-US')}.00`;
}

/**
 * Formats signed basis points using explicit + or Unicode minus '−' (U+2212).
 */
export function formatSignedPct(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || Number.isNaN(bps)) return '—';
  const absPct = (Math.abs(bps) / 100).toFixed(2);
  if (bps > 0) return `+${absPct}%`;
  if (bps < 0) return `−${absPct}%`;
  return `+0.00%`;
}

/**
 * Displays primary .skr handle first, falling back to middle-cut base58 address.
 */
export function displayIdentity(pubkey: string, skrName?: string | null): string {
  if (skrName && skrName.trim().length > 0) {
    return skrName.endsWith('.skr') ? skrName : `${skrName}.skr`;
  }
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}
