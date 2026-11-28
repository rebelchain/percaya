import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
  connectSeekerWallet,
  fetchDevnetBalanceSol,
  requestJudgeDevnetFaucet,
  signAndSendViaSeedVault,
  type SeekerSession,
} from '../mwa';

/**
 * Idiomatic Solana Mobile Wallet Adapter hook (`solana-mobile-skills` pattern).
 * Never silently spoofs a simulated wallet on error; surfaces honest MWA diagnostics
 * and provides live Devnet balance + 1-tap Judge Test SOL faucet for 0-SOL wallets.
 */
export function useMobileWallet(apiBaseUrl: string | null) {
  const [session, setSession] = useState<SeekerSession | null>(null);
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [funding, setFunding] = useState(false);

  const refreshBalance = useCallback(async (pubkey?: string) => {
    const target = pubkey ?? session?.pubkey;
    if (!target) {
      setBalanceSol(null);
      return;
    }
    try {
      const sol = await fetchDevnetBalanceSol(target);
      setBalanceSol(sol);
    } catch {
      // Keep previous balance on transient RPC failure
    }
  }, [session?.pubkey]);

  useEffect(() => {
    if (session?.pubkey) {
      void refreshBalance(session.pubkey);
    } else {
      setBalanceSol(null);
    }
  }, [session?.pubkey, refreshBalance]);

  const connect = useCallback(async (): Promise<SeekerSession | null> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConnecting(true);
    try {
      const next = await connectSeekerWallet(apiBaseUrl);
      setSession(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refreshBalance(next.pubkey);
      return next;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isMissingWallet =
        raw.includes('ERROR_WALLET_NOT_FOUND') || raw.includes('Found no installed wallet');
      Alert.alert(
        isMissingWallet ? 'No Compatible Wallet Found' : 'Connection Cancelled',
        isMissingWallet
          ? __DEV__
            ? 'Install Solana Seeker Seed Vault, Solflare, Phantom, or MWA Fake Wallet (dev) on this Android device.'
            : 'Install Solana Seeker Seed Vault, Solflare, or Phantom on this device to connect.'
          : raw || 'Wallet session was cancelled before signing in.',
      );
      return null;
    } finally {
      setConnecting(false);
    }
  }, [apiBaseUrl, refreshBalance]);

  const disconnect = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSession(null);
    setBalanceSol(null);
  }, []);

  const claimTestSol = useCallback(async () => {
    if (!session) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFunding(true);
    try {
      const res = await requestJudgeDevnetFaucet(session.pubkey, apiBaseUrl);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshBalance(session.pubkey);
      Alert.alert(
        'Devnet Test SOL Received',
        `+${res.amountSol.toFixed(2)} SOL confirmed on Solana Devnet.\nTx: ${res.signature.slice(0, 18)}…`,
      );
    } catch (err) {
      Alert.alert(
        'Devnet Faucet Limit',
        err instanceof Error
          ? `${err.message}\n\nTip: You can also fund this address at faucet.solana.com.`
          : 'Public Devnet faucet rate-limited. Try faucet.solana.com.',
      );
    } finally {
      setFunding(false);
    }
  }, [session, apiBaseUrl, refreshBalance]);

  const signAndSend = useCallback(
    async (serializedTxBase64: string): Promise<string> => {
      const sig = await signAndSendViaSeedVault(serializedTxBase64, session?.mwaAuthToken ?? null);
      void refreshBalance();
      return sig;
    },
    [session?.mwaAuthToken, refreshBalance],
  );

  return {
    session,
    balanceSol,
    connecting,
    funding,
    connect,
    disconnect,
    refreshBalance,
    claimTestSol,
    signAndSend,
  };
}
