export type OnboardingStepId = 'connect' | 'fund' | 'sgt' | 'call';

export interface OnboardingStepItem {
  id: OnboardingStepId;
  title: string;
  subtitle: string;
  ctaLabel: string;
  done: boolean;
}

export interface OnboardingProgressInput {
  connected: boolean;
  balanceSol: number | null;
  isSeekerVerified: boolean;
  hasInteractedCall: boolean;
}

/**
 * Pure state machine computing the 4-step Judge / First-Time User onboarding checklist.
 */
export function computeOnboardingSteps(input: OnboardingProgressInput): {
  steps: OnboardingStepItem[];
  completedCount: number;
  allDone: boolean;
} {
  const funded = input.connected && input.balanceSol !== null && input.balanceSol >= 0.06;
  const sgtDone = input.connected && input.isSeekerVerified;

  const steps: OnboardingStepItem[] = [
    {
      id: 'connect',
      title: '1. Connect Solana Wallet',
      subtitle: 'Works with Seed Vault, Solflare, or Phantom.',
      ctaLabel: 'Connect',
      done: input.connected,
    },
    {
      id: 'fund',
      title: '2. Get Devnet Test SOL (≥ 0.06 SOL)',
      subtitle:
        input.connected && input.balanceSol !== null
          ? `Current balance: ${input.balanceSol.toFixed(4)} SOL.`
          : 'Covers the reusable 0.05 SOL caller bond + pool stake.',
      ctaLabel: 'Get SOL',
      done: funded,
    },
    {
      id: 'sgt',
      title: '3. Verify with Seeker',
      subtitle: 'Anchors one permanent caller track record to your device.',
      ctaLabel: 'Verify',
      done: sgtDone,
    },
    {
      id: 'call',
      title: '4. Join a Pool or Post a Call',
      subtitle: 'Enter an open call window or lock SOL to open a pool.',
      ctaLabel: 'Post',
      done: input.hasInteractedCall,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  return {
    steps,
    completedCount,
    allDone: completedCount === steps.length,
  };
}

/**
 * Tap-to-explain copy for caller hardware reputation badges in the feed.
 */
export function explainTierBadge(
  isSeekerVerified: boolean,
  tier: number,
): { title: string; body: string } {
  if (!isSeekerVerified) {
    return {
      title: 'Unverified Wallet · Tier 0',
      body: 'This caller has not bound a hardware Seeker Genesis Token yet. Unverified wallets can still open calls, but are capped at 2× bond size and max 5% profit-only fee so burner wallets cannot scale.',
    };
  }
  const caps: Record<number, string> = {
    0: '2× bond cap · max 5% profit-only fee (building initial ≥3 settled record)',
    1: '5× bond cap · max 10% profit-only fee',
    2: '10× bond cap · max 15% profit-only fee',
    3: '20× bond cap · max 20% profit-only fee',
  };
  return {
    title: `Seeker Genesis Verified · Tier ${tier}`,
    body: `This caller bound a 1-per-device Token-2022 NonTransferable Seeker Genesis NFT into an immutable GenesisRegistry PDA (${caps[tier] ?? caps[0]}). Switching wallets cannot reset losses or slashes.`,
  };
}
