import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeOnboardingSteps, explainTierBadge } from './onboarding.ts';

test('computeOnboardingSteps tracks cold start -> connected -> funded -> SGT -> completed', () => {
  const cold = computeOnboardingSteps({
    connected: false,
    balanceSol: null,
    isSeekerVerified: false,
    hasInteractedCall: false,
  });
  assert.equal(cold.completedCount, 0);
  assert.equal(cold.allDone, false);

  const partial = computeOnboardingSteps({
    connected: true,
    balanceSol: 0.42,
    isSeekerVerified: false,
    hasInteractedCall: false,
  });
  assert.equal(partial.completedCount, 2);
  assert.equal(partial.steps[0].done, true);
  assert.equal(partial.steps[1].done, true);
  assert.equal(partial.steps[2].done, false);

  const full = computeOnboardingSteps({
    connected: true,
    balanceSol: 0.12,
    isSeekerVerified: true,
    hasInteractedCall: true,
  });
  assert.equal(full.completedCount, 4);
  assert.equal(full.allDone, true);
});

test('explainTierBadge differentiates Unverified T0 and Seeker Genesis tiers', () => {
  const unv = explainTierBadge(false, 0);
  assert.match(unv.title, /Unverified/);
  assert.match(unv.body, /2× bond/);

  const skr = explainTierBadge(true, 2);
  assert.match(skr.title, /Seeker Genesis Verified · Tier 2/);
  assert.match(skr.body, /10× bond/);
});
