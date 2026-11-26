import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeParticipantClaim,
  computeSettlement,
  computeTier,
  displayIdentity,
  evaluateSellRule,
  formatSignedPct,
  formatSolFloor,
  impactBps,
  maxImpactSol,
  quoteBuy,
  quoteSell,
} from './math.ts';

test('worked example 1: 100 SOL in, 130 SOL gross out, 10% share -> exact lamports & +26.88%', () => {
  const totalIn = 100_000_000_000n; // 100 SOL
  const grossOut = 130_000_000_000n; // 130 SOL
  const res = computeSettlement(totalIn, grossOut, 1000n, 10n);

  assert.equal(res.keeperRewardLamports, 130_000_000n); // 0.13 SOL
  assert.equal(res.netLamports, 129_870_000_000n); // 129.87 SOL
  assert.equal(res.profitLamports, 29_870_000_000n); // 29.87 SOL
  assert.equal(res.feeLamports, 2_987_000_000n); // 2.987 SOL
  assert.equal(res.payoutLamports, 126_883_000_000n); // 126.883 SOL
  assert.equal(res.netReturnBps, 2688); // +26.88%
  assert.equal(formatSignedPct(res.netReturnBps), '+26.88%');

  const callState = {
    state: 'Settled' as const,
    totalInLamports: totalIn.toString(),
    payoutLamports: res.payoutLamports.toString(),
    feeLamports: res.feeLamports.toString(),
    tokensBoughtAtoms: '0',
    claimedAmount: '0',
    claimsLeft: 4,
  };

  const callerClaim = computeParticipantClaim(10_000_000_000n, true, callState);
  const aClaim = computeParticipantClaim(30_000_000_000n, false, {
    ...callState,
    claimedAmount: '12688300000',
    claimsLeft: 3,
  });
  const bClaim = computeParticipantClaim(40_000_000_000n, false, {
    ...callState,
    claimedAmount: (12_688_300_000n + aClaim).toString(),
    claimsLeft: 2,
  });
  const cClaim = computeParticipantClaim(20_000_000_000n, false, {
    ...callState,
    claimedAmount: (12_688_300_000n + aClaim + bClaim).toString(),
    claimsLeft: 1,
  });

  assert.equal(callerClaim, 15_675_300_000n); // 15.6753 SOL
  assert.equal(aClaim, 38_064_900_000n); // 38.0649 SOL
  assert.equal(bClaim, 50_753_200_000n); // 50.7532 SOL
  assert.equal(cClaim, 25_376_600_000n); // 25.3766 SOL
  assert.equal(callerClaim + aClaim + bClaim + cClaim + res.keeperRewardLamports, grossOut);
});

test('worked example 2: 100 SOL in, 70 SOL gross out -> zero fee & −30.07%', () => {
  const res = computeSettlement(100_000_000_000n, 70_000_000_000n, 1000n, 10n);
  assert.equal(res.keeperRewardLamports, 70_000_000n);
  assert.equal(res.feeLamports, 0n);
  assert.equal(res.payoutLamports, 69_930_000_000n);
  assert.equal(res.netReturnBps, -3007);
  assert.equal(formatSignedPct(res.netReturnBps), '−30.07%');
});

test('closed-form maxImpactSol stays strictly <= 200 bps (2%) and +1 lamport exceeds or hits bound', () => {
  const solReserve = 250_000_000_000n; // 250 SOL
  const cap = maxImpactSol(solReserve, 200n, 30n);
  assert.ok(impactBps(solReserve, cap, 30n) <= 200);
  assert.ok(impactBps(solReserve, cap + 1_000_000n, 30n) > 200);

  const out = quoteBuy(solReserve, 250_000_000_000_000n, 1_000_000_000n, 30n);
  const back = quoteSell(solReserve + 1_000_000_000n, 250_000_000_000_000n - out, out, 30n);
  assert.ok(back < 1_000_000_000n && back > 990_000_000n);
});

test('Seeker Genesis hardware gating enforces Tier 0 on unverified or slashed callers', () => {
  const unverified = computeTier({
    settled: 15,
    slashes: 0,
    sumNetBps: 20_000,
    isSeekerVerified: false,
  });
  assert.equal(unverified.tier, 0);
  assert.equal(unverified.bondMultiple, 2);

  const verifiedT2 = computeTier({
    settled: 15,
    slashes: 0,
    sumNetBps: 20_000,
    isSeekerVerified: true,
  });
  assert.equal(verifiedT2.tier, 2);
  assert.equal(verifiedT2.bondMultiple, 10);

  const slashed = computeTier(
    { settled: 30, slashes: 0, sumNetBps: 50_000, isSeekerVerified: true },
    true,
  );
  assert.equal(slashed.tier, 0);
});

test('sell checkpoint rule rejects stale or single checkpoints and accepts spaced TP', () => {
  const single = evaluateSellRule({
    nowSec: 1000,
    totalInLamports: 1_000_000_000n,
    prevValue: 0n,
    prevAt: 0,
    lastValue: 1_300_000_000n,
    lastAt: 990,
    holdUntil: 2000,
    checkpointGapSec: 45,
    takeProfitBps: 2000,
    stopLossBps: 1500,
    sellToleranceBps: 200,
  });
  assert.equal(single.canSell, false);

  const validTp = evaluateSellRule({
    nowSec: 1050,
    totalInLamports: 1_000_000_000n,
    prevValue: 1_220_000_000n,
    prevAt: 980,
    lastValue: 1_250_000_000n,
    lastAt: 1030,
    holdUntil: 2000,
    checkpointGapSec: 45,
    takeProfitBps: 2000,
    stopLossBps: 1500,
    sellToleranceBps: 200,
  });
  assert.equal(validTp.canSell, true);
  assert.equal(validTp.reason, 'TakeProfit');
  assert.equal(validTp.minOutLamports, 1_195_600_000n);
});

test('formatting helpers floor SOL and format .skr identities', () => {
  assert.equal(formatSolFloor(12_688_399_999n, 4), '12.6883');
  assert.equal(displayIdentity('7bUd1Seeker111111111111111111111111111119fQp', 'budi.skr'), 'budi.skr');
  assert.equal(displayIdentity('7bUd1Seeker111111111111111111111111111119fQp', null), '7bUd…9fQp');
});
