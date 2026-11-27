import type { CallDetail } from '@percaya/core';

export interface CallStateNotice {
  callId: number;
  title: string;
  body: string;
}

function pct(bps: number | null): string {
  if (bps === null) return '';
  const v = (bps / 100).toFixed(2);
  return `${bps > 0 ? '+' : ''}${v}%`;
}

export type DiffableCall = Pick<CallDetail, 'callId' | 'state' | 'netReturnBps'> & {
  token: { symbol: string };
};

/**
 * Compares two snapshots of the on-chain feed and returns notices for watched calls
 * whose state changed (Open → Holding, → Settled, → Refunded, → Split).
 * Pure function: no native imports, unit-testable under plain Node.
 */
export function diffCallStates(
  prev: Pick<CallDetail, 'callId' | 'state'>[],
  next: DiffableCall[],
  watchedIds: number[],
): CallStateNotice[] {
  const before = new Map(prev.map((c) => [c.callId, c.state]));
  const out: CallStateNotice[] = [];
  for (const call of next) {
    if (!watchedIds.includes(call.callId)) continue;
    const old = before.get(call.callId);
    if (!old || old === call.state) continue;
    const label = `Call #${call.callId} · $${call.token.symbol}`;
    if (call.state === 'Holding') {
      out.push({
        callId: call.callId,
        title: `${label} bought`,
        body: 'The pool bought once for everyone. Rules are fixed; checkpoints are running.',
      });
    } else if (call.state === 'Settled') {
      out.push({
        callId: call.callId,
        title: `${label} settled ${pct(call.netReturnBps)}`.trim(),
        body: 'One sale for the whole pool. Open the thread to claim your share.',
      });
    } else if (call.state === 'Refunded') {
      out.push({
        callId: call.callId,
        title: `${label} refunded`,
        body: 'No buy happened. Every deposit can be claimed back 1:1.',
      });
    } else if (call.state === 'Split') {
      out.push({
        callId: call.callId,
        title: `${label} split`,
        body: 'The sale kept failing. Claim your pro-rata tokens instead.',
      });
    }
  }
  return out;
}
