import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CALLS } from '@percaya/core';
import { deriveActivityFeed } from './activity-feed.ts';

test('deriveActivityFeed groups Today vs Earlier, formats checkpoint countdowns, and surfaces Claim CTAs', () => {
  const nowSec = 2_000_000;
  const sample = JSON.parse(JSON.stringify(DEMO_CALLS.slice(0, 2))) as typeof DEMO_CALLS;

  // Call 1: Settled profit with unclaimed viewer position today
  sample[0].callId = 101;
  sample[0].state = 'Settled';
  sample[0].settleReason = 'TakeProfit';
  sample[0].netReturnBps = 2688;
  sample[0].lastCheckpoint = { valueLamports: '126880000', at: nowSec - 120 };
  sample[0].positions = [
    {
      callId: 101,
      participant: 'ViewerWallet1111111111111111111111111111111',
      skrName: null,
      depositedLamports: '10000000',
      claimed: false,
      claimableAmount: '12688000',
      isCaller: false,
    },
  ];

  // Call 2: Holding with Checkpoint 1/2 recorded 13s ago (32s left on 45s gap)
  sample[1].callId = 102;
  sample[1].state = 'Holding';
  sample[1].rules.checkpointGapSec = 45;
  sample[1].prevCheckpoint = { valueLamports: '0', at: 0 };
  sample[1].lastCheckpoint = { valueLamports: '11000000', at: nowSec - 13 };
  sample[1].openedAt = nowSec - 100_000;

  const feed = deriveActivityFeed({
    calls: sample,
    watching: [102],
    viewerPubkey: 'ViewerWallet1111111111111111111111111111111',
    nowSec,
  });

  assert.equal(feed.length, 2);
  const settledItem = feed.find((i) => i.callId === 101)!;
  assert.equal(settledItem.tone, 'gain');
  assert.equal(settledItem.actionKind, 'claim');
  assert.equal(settledItem.bucket, 'today');
  assert.equal(settledItem.isMine, true);
  assert.match(settledItem.body, /\+26\.88%/);

  const cpItem = feed.find((i) => i.callId === 102)!;
  assert.equal(cpItem.tone, 'holding');
  assert.match(cpItem.body, /unlocks in 32s/);
});
