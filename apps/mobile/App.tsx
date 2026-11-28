import {
  DEMO_CALLERS,
  DEMO_CALLS,
  DEMO_TOKENS,
  displayIdentity,
  type CallDetail,
  type CallerRecord,
  type ThreadReply,
  type TokenInfo,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { ActivityActionKind } from './src/activity-feed';
import { diffCallStates } from './src/call-diff';
import { buildCallDeepLink, parseCallIdFromLink } from './src/call-links';
import {
  buildDepositTxDirect,
  buildOpenCallTxDirect,
  buildPoolActionTxDirect,
  fetchDevnetStateDirect,
} from './src/chain-direct';
import { CallDetailModal } from './src/components/CallDetailModal';
import { CallerDetailModal } from './src/components/CallerDetailModal';
import { CallQrModal, CallScannerModal } from './src/components/CallQr';
import { ConnectSheet } from './src/components/ConnectSheet';
import { WelcomeModal } from './src/components/OnboardingGuide';
import {
  Bell,
  Home,
  PlusCircle,
  User,
  Users,
} from './src/components/ui/icons';
import { TopHeader, type ScreenTabKey } from './src/components/ui/TopHeader';
import { TxStatusSheet, type TxStatusState } from './src/components/ui/TxStatusSheet';
import { useMobileWallet } from './src/hooks/useMobileWallet';
import { ensureNotificationPermission, notifyNow } from './src/notifications';
import { computeOnboardingSteps, type OnboardingStepId } from './src/onboarding';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { CallersScreen } from './src/screens/CallersScreen';
import { ComposeScreen, type PublishedCallReceipt } from './src/screens/ComposeScreen';
import { HomeScreen, type FeedMode, type HomeFilterTab } from './src/screens/HomeScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { MIN_TOUCH_TARGET, RADII, SPACING, TYPE } from './src/theme/tokens';

const PUBLIC_API_ENV = process.env.EXPO_PUBLIC_API_URL?.trim();
const DEFAULT_PUBLIC_API = 'https://percaya.duckdns.org';
const API_CANDIDATES = [
  ...(PUBLIC_API_ENV ? [PUBLIC_API_ENV.replace(/\/$/, '')] : []),
  DEFAULT_PUBLIC_API,
  'http://127.0.0.1:8787',
  'http://10.0.2.2:8787',
];

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function PercayaShell() {
  const { colors, isDark } = useTheme();
  const [tab, setTab] = useState<ScreenTabKey>('home');
  const [feedMode, setFeedMode] = useState<FeedMode>('newest');
  const [stateFilter, setStateFilter] = useState<HomeFilterTab>('All');
  const [tokenFilter, setTokenFilter] = useState<string>('All');

  const [calls, setCalls] = useState<CallDetail[]>(
    () => JSON.parse(JSON.stringify(DEMO_CALLS)) as CallDetail[],
  );
  const [callers, setCallers] = useState<CallerRecord[]>(
    () => JSON.parse(JSON.stringify(DEMO_CALLERS)) as CallerRecord[],
  );
  const [tokens, setTokens] = useState<TokenInfo[]>(
    () => JSON.parse(JSON.stringify(DEMO_TOKENS)) as TokenInfo[],
  );

  const [apiMode, setApiMode] = useState<'demo' | 'chain' | 'offline'>('offline');
  const [backendOnline, setBackendOnline] = useState(false);
  const [apiBase, setApiBase] = useState<string>(API_CANDIDATES[0] ?? DEFAULT_PUBLIC_API);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [rpcOffline, setRpcOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // Live 1s clock for open-window countdowns and 45s checkpoint timers
  useEffect(() => {
    const id = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchLiveFeed = useCallback(async () => {
    let resolvedBase: string | null = null;
    for (const candidate of API_CANDIDATES) {
      try {
        const hRes = await fetchWithTimeout(`${candidate}/api/health`, undefined, 2000);
        if (hRes.ok) {
          const h = (await hRes.json()) as { mode?: 'demo' | 'chain' };
          setApiMode(h.mode === 'chain' ? 'chain' : 'demo');
          setBackendOnline(true);
          setApiBase(candidate);
          resolvedBase = candidate;
          break;
        }
      } catch {
        // Try next candidate
      }
    }

    if (resolvedBase) {
      try {
        const [callsRes, callersRes, cfgRes] = await Promise.all([
          fetchWithTimeout(`${resolvedBase}/api/calls`, undefined, 4000),
          fetchWithTimeout(`${resolvedBase}/api/callers`, undefined, 4000),
          fetchWithTimeout(`${resolvedBase}/api/config`, undefined, 3000).catch(() => null),
        ]);
        if (callsRes.ok) {
          const data = (await callsRes.json()) as { calls?: CallDetail[] };
          if (data.calls && data.calls.length > 0) {
            const detailed = await Promise.all(
              data.calls.slice(0, 14).map(async (c) => {
                const r = await fetchWithTimeout(
                  `${resolvedBase}/api/calls/${c.callId}`,
                  undefined,
                  4000,
                ).catch(() => null);
                if (r?.ok) {
                  const d = (await r.json()) as { call?: CallDetail };
                  if (d.call) return d.call;
                }
                return {
                  ...c,
                  positions: [],
                  earlyBuyers: [],
                  priceSeries: [],
                  replies: [],
                  buyTxSig: null,
                  sellTxSig: null,
                };
              }),
            );
            setCalls(detailed);
          }
        }
        if (callersRes.ok) {
          const cd = (await callersRes.json()) as { callers?: CallerRecord[] };
          if (cd.callers && cd.callers.length > 0) {
            setCallers(cd.callers);
          }
        }
        if (cfgRes?.ok) {
          const cfg = (await cfgRes.json()) as { tokens?: TokenInfo[] };
          if (cfg.tokens && cfg.tokens.length > 0) {
            setTokens(cfg.tokens);
          }
        }
        setRpcOffline(false);
        setLoadingInitial(false);
        return;
      } catch {
        // Fall through to direct on-device Solana Devnet RPC reader
      }
    }

    setBackendOnline(false);
    try {
      const direct = await fetchDevnetStateDirect();
      setApiMode('chain');
      setRpcOffline(false);
      if (direct.calls.length > 0) {
        setCalls((prev) => {
          const prevReplies = new Map(prev.map((c) => [c.callId, c.replies]));
          return direct.calls.map((c) => ({
            ...c,
            replies: prevReplies.get(c.callId) ?? c.replies,
          }));
        });
      }
      if (direct.callers.length > 0) setCallers(direct.callers);
      if (direct.tokens.length > 0) setTokens(direct.tokens);
    } catch {
      setApiMode('offline');
      setRpcOffline(true);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    void fetchLiveFeed();
    const timer = setInterval(() => void fetchLiveFeed(), 15_000);
    return () => clearInterval(timer);
  }, [fetchLiveFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLiveFeed();
    setRefreshing(false);
  }, [fetchLiveFeed]);

  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [selectedCaller, setSelectedCaller] = useState<CallerRecord | null>(null);
  const [following, setFollowing] = useState<string[]>([DEMO_CALLERS[0].pubkey]);
  const [watching, setWatching] = useState<number[]>([6, 5]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrCallId, setQrCallId] = useState<number | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [checklistHidden, setChecklistHidden] = useState(false);
  const [verifyingSgt, setVerifyingSgt] = useState(false);
  const [localSgtMint, setLocalSgtMint] = useState<string | null>(null);
  const [interactedCall, setInteractedCall] = useState(false);

  // Unified Connect Wallet BottomSheet state
  const [connectSheetOpen, setConnectSheetOpen] = useState(false);
  const [connectReason, setConnectReason] = useState<string | null>(null);
  const pendingAfterConnectRef = useRef<(() => void) | null>(null);

  // Transaction progress sheet state
  const [txStatus, setTxStatus] = useState<TxStatusState>({
    stage: 'idle',
    title: '',
  });
  const [busy, setBusy] = useState(false);

  const [replyDraft, setReplyDraft] = useState('');
  const [depositSol, setDepositSol] = useState('0.005');

  // 3-Step Create Call Wizard state (persisted across Android MWA Activity switches)
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [wizTokenIdx, setWizTokenIdx] = useState(0);
  const [wizStakeSol, setWizStakeSol] = useState('0.005');
  const [wizWindowMin, setWizWindowMin] = useState(5);
  const [wizTpPct, setWizTpPct] = useState(25);
  const [wizSlPct, setWizSlPct] = useState(15);
  const [wizMaxHoldMin, setWizMaxHoldMin] = useState(15);
  const [wizSharePct, setWizSharePct] = useState(5);
  const [wizThesis, setWizThesis] = useState(
    'Pooled entry on clean Devnet liquidity; TP and stop-loss locked at open.',
  );
  const [wizError, setWizError] = useState<string | null>(null);
  const [publishedReceipt, setPublishedReceipt] = useState<PublishedCallReceipt | null>(null);

  // Deep-link listener (`percaya://c/:id` & `https://percaya.duckdns.org/c/:id`)
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      const parsedId = parseCallIdFromLink(url);
      if (parsedId !== null) {
        setSelectedCallId(parsedId);
        setInteractedCall(true);
      }
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (ev) => handleUrl(ev.url));
    return () => sub.remove();
  }, []);

  // Push notifications when watched calls change on-chain state
  const prevCallsRef = useRef<Pick<CallDetail, 'callId' | 'state'>[]>([]);
  useEffect(() => {
    const prev = prevCallsRef.current;
    if (prev.length > 0) {
      for (const n of diffCallStates(prev, calls, watching)) {
        void notifyNow(n.title, n.body, n.callId);
      }
    }
    prevCallsRef.current = calls.map((c) => ({ callId: c.callId, state: c.state }));
  }, [calls, watching]);

  const {
    session,
    balanceSol,
    connecting,
    funding,
    connect: handleConnectMwa,
    disconnect: handleDisconnectMwa,
    claimTestSol,
    signAndSend,
  } = useMobileWallet(backendOnline ? apiBase : DEFAULT_PUBLIC_API);

  const requestConnect = useCallback((reason?: string, onConnected?: () => void) => {
    setConnectReason(reason ?? null);
    pendingAfterConnectRef.current = onConnected ?? null;
    setConnectSheetOpen(true);
  }, []);

  const executeConnectFromSheet = useCallback(async () => {
    const res = await handleConnectMwa();
    if (res) {
      setConnectSheetOpen(false);
      const cb = pendingAfterConnectRef.current;
      pendingAfterConnectRef.current = null;
      cb?.();
    }
  }, [handleConnectMwa]);

  const activeDetail: CallDetail | null = useMemo(
    () => calls.find((c) => c.callId === selectedCallId) ?? null,
    [calls, selectedCallId],
  );

  const myCallerRecord: CallerRecord | null = useMemo(
    () => (session ? callers.find((c) => c.pubkey === session.pubkey) ?? null : null),
    [callers, session],
  );

  useEffect(() => {
    setLocalSgtMint(null);
  }, [session?.pubkey]);

  const isMySeekerVerified = Boolean(myCallerRecord?.isSeekerVerified || localSgtMint);
  const hasMyCallActivity = useMemo(
    () =>
      interactedCall ||
      Boolean(
        session &&
          calls.some(
            (c) =>
              c.caller === session.pubkey ||
              c.positions.some((p) => p.participant === session.pubkey),
          ),
      ),
    [interactedCall, session, calls],
  );

  const onboardingState = useMemo(
    () =>
      computeOnboardingSteps({
        connected: Boolean(session),
        balanceSol,
        isSeekerVerified: isMySeekerVerified,
        hasInteractedCall: hasMyCallActivity,
      }),
    [session, balanceSol, isMySeekerVerified, hasMyCallActivity],
  );

  const handleVerifySeekerGenesis = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!session) {
      requestConnect('Connect your wallet to verify Seeker hardware.');
      return;
    }
    setVerifyingSgt(true);
    setTxStatus({
      stage: 'signing',
      title: 'Verify with Seeker',
      subtitle: 'Binding hardware identity to your permanent caller record',
    });
    try {
      const targetApi = backendOnline ? apiBase : DEFAULT_PUBLIC_API;
      const res = await fetchWithTimeout(
        `${targetApi}/api/devnet/issue-sgt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller: session.pubkey }),
        },
        12_000,
      );
      const data = (await res.json()) as {
        transaction?: string;
        genesisMint?: string;
        error?: string;
      };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error || 'Unable to prepare Seeker verification transaction');
      }
      const sig = await signAndSend(data.transaction);
      setLocalSgtMint(data.genesisMint ?? 'verified');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxStatus({
        stage: 'confirmed',
        title: 'Seeker Verified',
        subtitle: 'Your device is now bound to one permanent track record.',
        txSig: sig,
      });
      void fetchLiveFeed();
    } catch (err) {
      setTxStatus({
        stage: 'error',
        title: 'Verification Incomplete',
        errorMessage: err instanceof Error ? err.message : 'Unable to verify Seeker hardware',
        onRetry: () => void handleVerifySeekerGenesis(),
      });
    } finally {
      setVerifyingSgt(false);
    }
  };

  const handleChecklistAction = (stepId: OnboardingStepId) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (stepId === 'connect') {
      requestConnect('Connect your Solana wallet to begin.');
    } else if (stepId === 'fund') {
      void claimTestSol();
    } else if (stepId === 'sgt') {
      void handleVerifySeekerGenesis();
    } else if (stepId === 'call') {
      setTab('compose');
    }
  };

  const toggleFollow = (callerPubkey: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFollowing((prev) =>
      prev.includes(callerPubkey) ? prev.filter((p) => p !== callerPubkey) : [...prev, callerPubkey],
    );
  };

  const toggleWatch = (callId: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const adding = !watching.includes(callId);
    setWatching((prev) =>
      prev.includes(callId) ? prev.filter((id) => id !== callId) : [...prev, callId],
    );
    if (adding) void ensureNotificationPermission();
  };

  const handleCallScanned = (callId: number) => {
    setScannerOpen(false);
    setInteractedCall(true);
    if (calls.some((c) => c.callId === callId)) {
      setSelectedCallId(callId);
    } else {
      Alert.alert(
        `Call #${callId} syncing`,
        'Pull down to refresh the latest Devnet pools, then scan again.',
      );
    }
  };

  const handleShareCall = async (call: CallDetail) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `percaya Call #${call.callId} on $${call.token.symbol} by ${displayIdentity(call.caller, call.callerSkr)} — Same entry & exit price, rules fixed at open: ${buildCallDeepLink(call.callId)}`,
    });
  };

  const handleDepositIntoPool = async (call: CallDetail) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!session) {
      requestConnect(`Connect wallet to join Call #${call.callId} ($${call.token.symbol}).`, () => {
        setSelectedCallId(call.callId);
      });
      return;
    }
    setBusy(true);
    setTxStatus({
      stage: 'signing',
      title: `Join $${call.token.symbol} Pool`,
      subtitle: `Depositing ${depositSol} SOL into Call #${call.callId}`,
    });
    try {
      let txBase64: string | null = null;
      if (backendOnline) {
        try {
          const res = await fetchWithTimeout(
            `${apiBase}/api/actions/call/${call.callId}?amount=${depositSol}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ account: session.pubkey }),
            },
            5000,
          );
          if (res.ok) {
            const payload = (await res.json()) as { transaction: string };
            txBase64 = payload.transaction;
          }
        } catch {
          // Fall back to direct on-device Devnet builder
        }
      }
      if (!txBase64) {
        const direct = await buildDepositTxDirect({
          call,
          accountBase58: session.pubkey,
          amountSol: Number(depositSol),
        });
        txBase64 = direct.transaction;
      }
      const sig = await signAndSend(txBase64);
      setInteractedCall(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWatching((prev) => (prev.includes(call.callId) ? prev : [...prev, call.callId]));
      void ensureNotificationPermission();
      setTxStatus({
        stage: 'confirmed',
        title: `Joined Call #${call.callId}`,
        subtitle: `Locked ${depositSol} SOL at the exact caller entry price.`,
        txSig: sig,
      });
      void fetchLiveFeed();
    } catch (err) {
      setTxStatus({
        stage: 'error',
        title: 'Join Pool Incomplete',
        errorMessage: err instanceof Error ? err.message : 'Unable to send deposit transaction',
        onRetry: () => void handleDepositIntoPool(call),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenCallOnChain = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!session) {
      requestConnect('Connect your wallet to lock SOL and publish your call.');
      return;
    }
    const chosenToken = tokens[wizTokenIdx] ?? tokens[0];
    setWizError(null);
    setBusy(true);
    setTxStatus({
      stage: 'signing',
      title: `Post $${chosenToken.symbol} Call`,
      subtitle: `Locking ${wizStakeSol} SOL stake under immutable TP/SL rules`,
    });
    try {
      let txData: { transaction: string; callId: number } | null = null;
      if (backendOnline) {
        try {
          const res = await fetchWithTimeout(
            `${apiBase}/api/tx/open-call`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caller: session.pubkey,
                tokenSymbol: chosenToken.symbol,
                stakeSol: Number(wizStakeSol),
                windowMin: wizWindowMin,
                tpPct: wizTpPct,
                slPct: wizSlPct,
                maxHoldMin: wizMaxHoldMin,
                sharePct: wizSharePct,
                thesis: wizThesis,
              }),
            },
            6000,
          );
          if (res.ok) {
            txData = (await res.json()) as { transaction: string; callId: number };
          }
        } catch {
          // Fall back to direct on-device Devnet builder
        }
      }
      if (!txData) {
        txData = await buildOpenCallTxDirect({
          callerBase58: session.pubkey,
          tokenSymbol: chosenToken.symbol,
          stakeSol: Number(wizStakeSol),
          windowMin: wizWindowMin,
          tpPct: wizTpPct,
          slPct: wizSlPct,
          maxHoldMin: wizMaxHoldMin,
          sharePct: wizSharePct,
          thesis: wizThesis,
        });
      }
      const sig = await signAndSend(txData.transaction);
      setInteractedCall(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxStatus({ stage: 'idle', title: '' });
      setPublishedReceipt({
        callId: txData.callId,
        symbol: chosenToken.symbol,
        stakeSol: wizStakeSol,
        txSig: sig,
      });
      setWatching((prev) => (prev.includes(txData!.callId) ? prev : [...prev, txData!.callId]));
      void ensureNotificationPermission();
      void fetchLiveFeed();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to publish call';
      setWizError(msg);
      setTxStatus({
        stage: 'error',
        title: 'Call Not Published',
        errorMessage: msg,
        onRetry: () => void handleOpenCallOnChain(),
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePoolActionTx = async (
    action: 'buy' | 'checkpoint' | 'sell' | 'claim',
    call: CallDetail,
  ) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!session) {
      requestConnect(`Connect wallet to ${action} on Call #${call.callId}.`);
      return;
    }
    const labels: Record<typeof action, string> = {
      buy: `Execute Pool Buy ($${call.token.symbol})`,
      checkpoint: `Record Checkpoint ($${call.token.symbol})`,
      sell: `Execute Pool Sale ($${call.token.symbol})`,
      claim: `Claim SOL ($${call.token.symbol})`,
    };
    setBusy(true);
    setTxStatus({
      stage: 'signing',
      title: labels[action],
      subtitle: `Call #${call.callId}`,
    });
    try {
      let txBase64: string | null = null;
      if (backendOnline) {
        try {
          const res = await fetchWithTimeout(
            `${apiBase}/api/tx/${action}/${call.callId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ account: session.pubkey }),
            },
            5000,
          );
          if (res.ok) {
            const payload = (await res.json()) as { transaction: string };
            txBase64 = payload.transaction;
          }
        } catch {
          // Fall back to direct on-device Devnet builder
        }
      }
      if (!txBase64) {
        const direct = await buildPoolActionTxDirect({
          action,
          signerBase58: session.pubkey,
          call,
        });
        txBase64 = direct.transaction;
      }
      const sig = await signAndSend(txBase64);
      setInteractedCall(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxStatus({
        stage: 'confirmed',
        title: labels[action],
        subtitle: `Confirmed on Solana Devnet for Call #${call.callId}.`,
        txSig: sig,
      });
      void fetchLiveFeed();
    } catch (err) {
      setTxStatus({
        stage: 'error',
        title: `${labels[action]} Incomplete`,
        errorMessage: err instanceof Error ? err.message : 'Unable to send transaction',
        onRetry: () => void handlePoolActionTx(action, call),
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePostReply = (call: CallDetail) => {
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    if (!session) {
      requestConnect('Connect wallet to post a thread reply (auto-tagged In Pool vs Spectator).');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const pos = call.positions.find((p) => p.participant === session.pubkey);
    const newReply: ThreadReply = {
      id: `rep-${call.callId}-${Date.now()}`,
      callId: call.callId,
      author: session.pubkey,
      authorSkr: session.skrName,
      authorSeekerVerified: isMySeekerVerified,
      depositedLamports: pos?.depositedLamports ?? '0',
      isCaller: call.caller === session.pubkey,
      body: trimmed,
      createdAt: Math.floor(Date.now() / 1000),
    };

    setCalls((prev) =>
      prev.map((c) => (c.callId === call.callId ? { ...c, replies: [...c.replies, newReply] } : c)),
    );
    setReplyDraft('');

    if (session.apiBearerToken) {
      void fetch(`${apiBase}/api/calls/${call.callId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.apiBearerToken}`,
        },
        body: JSON.stringify({ body: trimmed }),
      }).catch(() => {});
    }
  };

  const handleActivityAction = (kind: ActivityActionKind, call: CallDetail) => {
    if (kind === 'view') {
      setSelectedCallId(call.callId);
      return;
    }
    void handlePoolActionTx(kind, call);
  };

  const navItems: {
    key: ScreenTabKey;
    label: string;
    Icon: typeof Home;
  }[] = [
    { key: 'home', label: 'Home', Icon: Home },
    { key: 'explore', label: 'Callers', Icon: Users },
    { key: 'compose', label: 'Post', Icon: PlusCircle },
    { key: 'activity', label: 'Activity', Icon: Bell },
    { key: 'profile', label: 'Profile', Icon: User },
  ];

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
      <StatusBar
        style={isDark ? 'light' : 'dark'}
        backgroundColor={colors.surface}
        translucent={false}
      />

      <TopHeader
        tab={tab}
        apiMode={apiMode}
        session={session}
        balanceSol={balanceSol}
        connecting={connecting}
        onOpenGuide={() => setWelcomeOpen(true)}
        onOpenScanner={() => setScannerOpen(true)}
        onPressWallet={() => {
          if (session) {
            setTab('profile');
          } else {
            requestConnect();
          }
        }}
      />

      <View style={{ flex: 1 }}>
        {tab === 'home' && (
          <HomeScreen
            calls={calls}
            nowSec={nowSec}
            loadingInitial={loadingInitial}
            refreshing={refreshing}
            rpcOffline={rpcOffline}
            feedMode={feedMode}
            onChangeFeedMode={setFeedMode}
            stateFilter={stateFilter}
            onChangeStateFilter={setStateFilter}
            tokenFilter={tokenFilter}
            onClearTokenFilter={() => setTokenFilter('All')}
            following={following}
            watching={watching}
            viewerPubkey={session?.pubkey}
            balanceSol={balanceSol}
            funding={funding}
            busy={busy}
            showChecklist={!checklistHidden && !onboardingState.allDone}
            onboardingSteps={onboardingState.steps}
            onboardingCompletedCount={onboardingState.completedCount}
            onChecklistAction={handleChecklistAction}
            onDismissChecklist={() => setChecklistHidden(true)}
            onClaimFaucet={() => void claimTestSol()}
            onRefresh={() => void onRefresh()}
            onOpenCall={(c) => setSelectedCallId(c.callId)}
            onOpenCaller={(pk) => {
              const found = callers.find((x) => x.pubkey === pk) ?? null;
              setSelectedCaller(found);
            }}
            onJoinCall={(c) => {
              if (!session) {
                requestConnect(`Connect wallet to join Call #${c.callId} ($${c.token.symbol}).`, () => {
                  setSelectedCallId(c.callId);
                });
              } else {
                setSelectedCallId(c.callId);
              }
            }}
            onExecuteBuy={(c) => void handlePoolActionTx('buy', c)}
            onToggleWatch={toggleWatch}
            onShareCall={(c) => void handleShareCall(c)}
            onCreateCall={() => setTab('compose')}
          />
        )}

        {tab === 'explore' && (
          <CallersScreen
            callers={callers}
            calls={calls}
            tokens={tokens}
            following={following}
            nowSec={nowSec}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            onToggleFollow={toggleFollow}
            onSelectCaller={setSelectedCaller}
          />
        )}

        {tab === 'compose' && (
          <ComposeScreen
            tokens={tokens}
            step={wizStep}
            onChangeStep={setWizStep}
            tokenIdx={wizTokenIdx}
            onChangeTokenIdx={setWizTokenIdx}
            stakeSol={wizStakeSol}
            onChangeStakeSol={setWizStakeSol}
            windowMin={wizWindowMin}
            onChangeWindowMin={setWizWindowMin}
            tpPct={wizTpPct}
            onChangeTpPct={setWizTpPct}
            slPct={wizSlPct}
            onChangeSlPct={setWizSlPct}
            maxHoldMin={wizMaxHoldMin}
            onChangeMaxHoldMin={setWizMaxHoldMin}
            sharePct={wizSharePct}
            onChangeSharePct={setWizSharePct}
            thesis={wizThesis}
            onChangeThesis={setWizThesis}
            connected={Boolean(session)}
            balanceSol={balanceSol}
            myCallerRecord={myCallerRecord}
            isSeekerVerified={isMySeekerVerified}
            busy={busy}
            submitError={wizError}
            publishedReceipt={publishedReceipt}
            onClearReceipt={() => {
              setPublishedReceipt(null);
              setWizStep(1);
            }}
            onConnect={() => requestConnect('Connect wallet to lock SOL and publish a call.')}
            onPublish={() => void handleOpenCallOnChain()}
            onSharePublished={(callId) => {
              const found = calls.find((c) => c.callId === callId);
              if (found) {
                void handleShareCall(found);
              } else {
                void Share.share({
                  message: `percaya Call #${callId} is live on Solana: ${buildCallDeepLink(callId)}`,
                });
              }
            }}
            onShowQrPublished={(callId) => setQrCallId(callId)}
            onViewPublishedThread={(callId) => {
              setPublishedReceipt(null);
              setWizStep(1);
              setTab('home');
              setSelectedCallId(callId);
            }}
          />
        )}

        {tab === 'activity' && (
          <ActivityScreen
            calls={calls}
            watching={watching}
            viewerPubkey={session?.pubkey}
            nowSec={nowSec}
            busy={busy}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            onOpenCall={(id) => setSelectedCallId(id)}
            onAction={handleActivityAction}
            onBrowseHome={() => setTab('home')}
          />
        )}

        {tab === 'profile' && (
          <ProfileScreen
            session={session}
            balanceSol={balanceSol}
            myCallerRecord={myCallerRecord}
            isSeekerVerified={isMySeekerVerified}
            localSgtMint={localSgtMint}
            calls={calls}
            nowSec={nowSec}
            connecting={connecting}
            funding={funding}
            verifyingSgt={verifyingSgt}
            busy={busy}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            onConnect={() => requestConnect()}
            onDisconnect={handleDisconnectMwa}
            onVerifySeeker={() => void handleVerifySeekerGenesis()}
            onClaimFaucet={() => void claimTestSol()}
            onOpenCall={(c) => setSelectedCallId(c.callId)}
            onClaimPosition={(c) => void handlePoolActionTx('claim', c)}
          />
        )}
      </View>

      {/* Consistent 5-Tab Bottom Bar with Lucide Line Icons */}
      <View style={[s.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        {navItems.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTab(key);
              }}
              style={[
                s.tabItem,
                active && { backgroundColor: colors.openFill },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Icon
                size={20}
                color={active ? colors.openText : colors.ink3}
                strokeWidth={active ? 2.2 : 1.8}
              />
              <Text
                style={[
                  TYPE.micro,
                  {
                    fontSize: 11,
                    color: active ? colors.openText : colors.ink3,
                    fontWeight: active ? '700' : '500',
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Modals & Sheets */}
      <ConnectSheet
        visible={connectSheetOpen}
        connecting={connecting}
        reason={connectReason}
        onClose={() => setConnectSheetOpen(false)}
        onConnect={() => void executeConnectFromSheet()}
      />

      <TxStatusSheet
        status={txStatus}
        onClose={() => setTxStatus({ stage: 'idle', title: '' })}
      />

      <WelcomeModal
        visible={welcomeOpen}
        connected={Boolean(session)}
        onClose={() => setWelcomeOpen(false)}
        onConnect={() => requestConnect()}
      />

      <CallScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCallScanned={handleCallScanned}
      />

      <CallQrModal
        callId={qrCallId}
        symbol={calls.find((c) => c.callId === qrCallId)?.token.symbol}
        onClose={() => setQrCallId(null)}
      />

      <CallDetailModal
        call={activeDetail}
        nowSec={nowSec}
        viewerPubkey={session?.pubkey}
        isWatching={activeDetail ? watching.includes(activeDetail.callId) : false}
        depositSol={depositSol}
        onChangeDepositSol={setDepositSol}
        replyDraft={replyDraft}
        onChangeReplyDraft={setReplyDraft}
        busy={busy}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        onClose={() => setSelectedCallId(null)}
        onShowQr={(id) => setQrCallId(id)}
        onShare={(c) => void handleShareCall(c)}
        onToggleWatch={toggleWatch}
        onOpenCaller={(pk) => {
          const found = callers.find((x) => x.pubkey === pk) ?? null;
          setSelectedCaller(found);
        }}
        onPostReply={handlePostReply}
        onDeposit={(c) => void handleDepositIntoPool(c)}
        onPoolAction={(act, c) => void handlePoolActionTx(act, c)}
      />

      <CallerDetailModal
        caller={selectedCaller}
        calls={calls}
        isFollowing={selectedCaller ? following.includes(selectedCaller.pubkey) : false}
        nowSec={nowSec}
        onClose={() => setSelectedCaller(null)}
        onToggleFollow={toggleFollow}
        onSelectCall={(id) => setSelectedCallId(id)}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PercayaShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  bottomBar: {
    minHeight: 58,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: 4,
    gap: 2,
  },
  tabItem: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
