import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffCallStates, type DiffableCall } from './call-diff.ts';

const mk = (callId: number, state: DiffableCall['state'], netReturnBps: number | null = null): DiffableCall => ({
  callId,
  state,
  netReturnBps,
  token: { symbol: 'tBONK' },
});

test('notifies only watched calls whose state changed', () => {
  const prev = [
    { callId: 1, state: 'Open' as const },
    { callId: 2, state: 'Open' as const },
  ];
  const next = [mk(1, 'Holding'), mk(2, 'Holding')];
  const out = diffCallStates(prev, next, [1]);
  assert.equal(out.length, 1);
  assert.equal(out[0].callId, 1);
  assert.match(out[0].title, /bought/);
});

test('settled notice carries the signed net return', () => {
  const win = diffCallStates([{ callId: 5, state: 'Holding' }], [mk(5, 'Settled', 2688)], [5]);
  assert.match(win[0].title, /\+26\.88%/);
  const loss = diffCallStates([{ callId: 5, state: 'Holding' }], [mk(5, 'Settled', -3007)], [5]);
  assert.match(loss[0].title, /-30\.07%/);
});

test('no notice for unchanged state or a call first seen', () => {
  assert.equal(diffCallStates([{ callId: 1, state: 'Open' }], [mk(1, 'Open')], [1]).length, 0);
  assert.equal(diffCallStates([], [mk(9, 'Settled', 100)], [9]).length, 0);
});

test('refund and split get their own notices', () => {
  const r = diffCallStates([{ callId: 3, state: 'Open' }], [mk(3, 'Refunded')], [3]);
  assert.match(r[0].title, /refunded/);
  const s = diffCallStates([{ callId: 4, state: 'Holding' }], [mk(4, 'Split')], [4]);
  assert.match(s[0].title, /split/);
});
