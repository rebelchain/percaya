export const BPS_DENOMINATOR = 10_000;
export const BPS_DENOMINATOR_N = 10_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const LAMPORTS_PER_SOL_N = 1_000_000_000n;

export type CallState = 'Open' | 'Holding' | 'Settled' | 'Refunded' | 'Split';

export type SettleReason =
  | 'None'
  | 'TakeProfit'
  | 'StopLoss'
  | 'MaxHold'
  | 'MinPoolRefund'
  | 'DeadlineRefund'
  | 'Split';

export interface ProtocolParams {
  minBondLamports: string;
  minPoolLamports: string;
  minWindowSec: number;
  maxWindowSec: number;
  buyGraceSec: number;
  minHoldSec: number;
  maxHoldSec: number;
  checkpointGapSec: number;
  splitGraceSec: number;
  bondCooldownSec: number;
  minStopLossBps: number;
  maxStopLossBps: number;
  minCallerBps: number;
  maxImpactBps: number;
  sellToleranceBps: number;
  keeperBps: number;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  ammPool: string;
  allowed: boolean;
  solReserveLamports: string;
  tokenReserveAtoms: string;
  feeBps: number;
}

export interface CallRules {
  ammPool: string;
  windowEnd: number; // unix seconds
  buyDeadline: number; // unix seconds
  maxHoldSec: number;
  takeProfitBps: number; // 0 = disabled
  stopLossBps: number; // 100..9000
  shareBps: number; // caller profit share
  minCallerBps: number; // 500 = 5%
  maxImpactBps: number; // 200 = 2%
  sellToleranceBps: number; // 200 = 2%
  keeperBps: number; // 10 = 0.1%
  checkpointGapSec: number;
  splitGraceSec: number;
  capLamports: string; // bond * tierMultiple at open
  minPoolLamports: string;
}

export interface Checkpoint {
  valueLamports: string;
  at: number; // unix seconds, 0 if unset
}

export interface TierInfo {
  tier: 0 | 1 | 2 | 3;
  bondMultiple: 2 | 5 | 10 | 20;
  maxShareBps: 500 | 1000 | 1500 | 2000;
  reason: string;
}

export interface SlashEntry {
  at: number;
  amountLamports: string;
  reason: string;
  txSig: string;
}

export interface CallerRecord {
  pubkey: string;
  skrName: string | null;
  genesisMint: string | null;
  isSeekerVerified: boolean;
  genesisSlashed: boolean;
  bondLamports: string;
  withdrawReadyAt: number;
  settled: number;
  losses: number;
  negligent: number;
  refunded: number;
  split: number;
  slashes: number;
  active: number;
  lastActive: number;
  sumNetBps: number;
  avgNetBps: number | null;
  tierInfo: TierInfo;
  slashHistory: SlashEntry[];
}

export interface ParticipantPosition {
  callId: number;
  participant: string;
  skrName: string | null;
  depositedLamports: string;
  claimed: boolean;
  claimableAmount: string; // lamports for Settled/Refunded, token atoms for Split
  isCaller: boolean;
}

export interface EarlyBuyer {
  buyerPubkey: string;
  skrName: string | null;
  secondsBeforeBuy: number;
  solSpentLamports: string;
  fundedByCaller: boolean;
  fundingTxSig: string | null;
  swapTxSig: string;
}

export interface PricePoint {
  at: number;
  quoteMultipleBps: number; // 10000 = 1.00x entry
}

export interface CallSummary {
  callId: number;
  pda: string;
  caller: string;
  callerSkr: string | null;
  callerSeekerVerified: boolean;
  callerTier: 0 | 1 | 2 | 3;
  callerSettled: number;
  callerLosses: number;
  callerAvgNetBps: number | null;
  token: TokenInfo;
  state: CallState;
  settleReason: SettleReason;
  openedAt: number;
  boughtAt: number;
  holdUntil: number;
  rules: CallRules;
  totalInLamports: string;
  callerStakeLamports: string;
  liveCapLamports: string; // min(rules.cap, 2% impact ceiling)
  depositorsCount: number;
  claimsLeft: number;
  tokensBoughtAtoms: string;
  prevCheckpoint: Checkpoint;
  lastCheckpoint: Checkpoint;
  liveQuoteLamports: string | null; // indicative AMM sell quote when Holding
  liveQuoteNetBps: number | null;
  grossOutLamports: string;
  payoutLamports: string;
  feeLamports: string;
  claimedAmount: string;
  netReturnBps: number | null; // final signed net return on Settled
  thesis: string;
}

export interface ThreadReply {
  id: string;
  callId: number;
  author: string;
  authorSkr: string | null;
  authorSeekerVerified: boolean;
  depositedLamports: string; // "0" => Spectator, >0 => "In Pool · X SOL"
  isCaller: boolean;
  body: string;
  createdAt: number;
}

export interface CallDetail extends CallSummary {
  positions: ParticipantPosition[];
  earlyBuyers: EarlyBuyer[];
  priceSeries: PricePoint[];
  replies: ThreadReply[];
  buyTxSig: string | null;
  sellTxSig: string | null;
}

export interface AlertItem {
  id: string;
  callId: number;
  kind: 'call_opened' | 'pool_bought' | 'checkpoint_hit' | 'pool_settled' | 'pool_refunded' | 'bond_slashed';
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}
