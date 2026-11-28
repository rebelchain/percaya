import {
  displayIdentity,
  evaluateSellRule,
  formatSignedPct,
  formatSolFloor,
  type CallDetail,
} from '@percaya/core';
import { formatCountdownShort } from './theme/format.ts';

export type ActivityTone = 'gain' | 'loss' | 'holding' | 'open' | 'refunded';
export type ActivityActionKind = 'claim' | 'buy' | 'checkpoint' | 'sell' | 'view';

export interface DerivedActivityItem {
  id: string;
  callId: number;
  tone: ActivityTone;
  title: string;
  body: string;
  timestamp: number;
  bucket: 'today' | 'earlier';
  isMine: boolean;
  actionKind: ActivityActionKind;
  actionLabel: string;
}

/**
 * Pure derivation of structured, trader-clear Activity events from live synced `calls`.
 * Updates dynamically every second (`nowSec`) for live checkpoint & join-window countdowns.
 */
export function deriveActivityFeed(params: {
  calls: CallDetail[];
  watching: number[];
  viewerPubkey?: string | null;
  nowSec: number;
}): DerivedActivityItem[] {
  const { calls, watching, viewerPubkey, nowSec } = params;
  const dayCutoff = nowSec - 86_400;
  const items: DerivedActivityItem[] = [];

  for (const call of calls) {
    const myPos = viewerPubkey
      ? call.positions.find((p) => p.participant === viewerPubkey)
      : undefined;
    const isParticipant = Boolean(myPos && BigInt(myPos.depositedLamports) > 0n);
    const isCaller = Boolean(viewerPubkey && call.caller === viewerPubkey);
    const isWatched = watching.includes(call.callId);
    const isMine = isCaller || isParticipant || isWatched;
    const callerHandle = displayIdentity(call.caller, call.callerSkr);
    const hasUnclaimed = Boolean(
      myPos && !myPos.claimed && BigInt(myPos.claimableAmount || '0') > 0n,
    );

    if (call.state === 'Settled') {
      const bps = call.netReturnBps ?? 0;
      const isProfit = bps >= 0;
      const reasonText =
        call.settleReason === 'TakeProfit'
          ? 'Take-profit hit at checkpoint 2/2'
          : call.settleReason === 'StopLoss'
            ? 'Stop-loss triggered at checkpoint 2/2'
            : 'Max hold window completed';
      const ts = call.lastCheckpoint.at || call.boughtAt || call.openedAt;

      items.push({
        id: `settled-${call.callId}`,
        callId: call.callId,
        tone: isProfit ? 'gain' : 'loss',
        title: `$${call.token.symbol} Call #${call.callId} settled (${formatSignedPct(bps)})`,
        body: hasUnclaimed
          ? `${reasonText} (${formatSignedPct(bps)}). Your ${formatSolFloor(myPos!.claimableAmount, 4)} SOL payout is ready to claim.`
          : `${reasonText} (${formatSignedPct(bps)}). Pro-rata SOL exits unlocked for ${call.depositorsCount} participant${call.depositorsCount === 1 ? '' : 's'}.`,
        timestamp: ts,
        bucket: ts >= dayCutoff ? 'today' : 'earlier',
        isMine,
        actionKind: hasUnclaimed ? 'claim' : 'view',
        actionLabel: hasUnclaimed ? 'Claim SOL' : 'View call',
      });
      continue;
    }

    if (call.state === 'Holding') {
      const hasCp1 = call.lastCheckpoint.at > 0;
      const hasCp2 = call.prevCheckpoint.at > 0 && call.lastCheckpoint.at > 0;
      const sellEval = evaluateSellRule({
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

      const ts = call.lastCheckpoint.at || call.boughtAt || call.openedAt;

      if (sellEval.canSell) {
        items.push({
          id: `holding-sell-${call.callId}`,
          callId: call.callId,
          tone: 'holding',
          title: `$${call.token.symbol} Call #${call.callId} ready for exit sale`,
          body: `Checkpoints 2/2 verified (${sellEval.reason}). Anyone can execute the pool sale now and earn the 0.10% keeper reward.`,
          timestamp: ts,
          bucket: ts >= dayCutoff ? 'today' : 'earlier',
          isMine,
          actionKind: 'sell',
          actionLabel: 'Execute sale',
        });
      } else if (hasCp1 && !hasCp2) {
        const nextAllowedAt = call.lastCheckpoint.at + call.rules.checkpointGapSec;
        const waitSec = Math.max(0, nextAllowedAt - nowSec);
        items.push({
          id: `holding-cp1-${call.callId}`,
          callId: call.callId,
          tone: 'holding',
          title: `Checkpoint 1/2 recorded on $${call.token.symbol} #${call.callId}`,
          body:
            waitSec > 0
              ? `Next check unlocks in ${waitSec}s, then anyone can confirm checkpoint 2/2 and trigger the sale.`
              : `Checkpoint gap elapsed — record checkpoint 2/2 now to verify exit conditions.`,
          timestamp: ts,
          bucket: ts >= dayCutoff ? 'today' : 'earlier',
          isMine,
          actionKind: waitSec > 0 ? 'view' : 'checkpoint',
          actionLabel: waitSec > 0 ? `${waitSec}s` : 'Checkpoint',
        });
      } else {
        const liveStr =
          call.liveQuoteNetBps !== null ? ` (${formatSignedPct(call.liveQuoteNetBps)} live)` : '';
        items.push({
          id: `holding-${call.callId}`,
          callId: call.callId,
          tone: 'holding',
          title: `$${call.token.symbol} Call #${call.callId} holding${liveStr}`,
          body: `Pool bought in one swap (${formatSolFloor(call.totalInLamports, 3)} SOL). Monitoring TP +${(call.rules.takeProfitBps / 100).toFixed(0)}% / SL −${(call.rules.stopLossBps / 100).toFixed(0)}%.`,
          timestamp: ts,
          bucket: ts >= dayCutoff ? 'today' : 'earlier',
          isMine,
          actionKind: 'checkpoint',
          actionLabel: 'Checkpoint',
        });
      }
      continue;
    }

    if (call.state === 'Open') {
      const countdown = formatCountdownShort(call.rules.windowEnd, nowSec);
      const canCallerBuy =
        nowSec >= call.rules.windowEnd &&
        nowSec <= call.rules.buyDeadline &&
        isCaller &&
        BigInt(call.totalInLamports) >= BigInt(call.rules.minPoolLamports);

      items.push({
        id: `open-${call.callId}`,
        callId: call.callId,
        tone: countdown ? 'open' : 'holding',
        title: countdown
          ? `New call on $${call.token.symbol} by ${callerHandle}`
          : `Join window closed on $${call.token.symbol} #${call.callId}`,
        body: countdown
          ? `${countdown} to join at caller's entry (${formatSolFloor(call.totalInLamports, 3)} SOL pooled · TP +${(call.rules.takeProfitBps / 100).toFixed(0)}% / SL −${(call.rules.stopLossBps / 100).toFixed(0)}%).`
          : canCallerBuy
            ? `Window closed with ${formatSolFloor(call.totalInLamports, 3)} SOL pooled. Execute the pool buy before the grace deadline.`
            : `Join window closed (${formatSolFloor(call.totalInLamports, 3)} SOL pooled). Waiting for caller pool buy.`,
        timestamp: call.openedAt,
        bucket: call.openedAt >= dayCutoff ? 'today' : 'earlier',
        isMine,
        actionKind: canCallerBuy ? 'buy' : 'view',
        actionLabel: canCallerBuy ? 'Execute buy' : countdown ? 'View call' : 'Details',
      });
      continue;
    }

    if (call.state === 'Refunded') {
      items.push({
        id: `refunded-${call.callId}`,
        callId: call.callId,
        tone: 'refunded',
        title: `$${call.token.symbol} Call #${call.callId} refunded 1:1`,
        body: hasUnclaimed
          ? `Pool did not execute buy. Your ${formatSolFloor(myPos!.claimableAmount, 4)} SOL deposit is ready to withdraw.`
          : 'Window closed without pool buy — all deposits unlocked 1:1 with zero fees.',
        timestamp: call.openedAt,
        bucket: call.openedAt >= dayCutoff ? 'today' : 'earlier',
        isMine,
        actionKind: hasUnclaimed ? 'claim' : 'view',
        actionLabel: hasUnclaimed ? 'Claim SOL' : 'View',
      });
    }
  }

  return items.sort((a, b) => b.timestamp - a.timestamp || b.callId - a.callId);
}
