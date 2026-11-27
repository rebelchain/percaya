import {
  DEMO_ALERTS,
  DEMO_CALLERS,
  DEMO_CALLS,
  DEMO_TOKENS,
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  impactBps,
  type CallDetail,
  type CallState,
  type CallerRecord,
  type ThreadReply,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { connectSeekerWallet, signAndSendViaSeedVault, type SeekerSession } from './src/mwa';

/** Calm Daylight Threads Design Tokens (docs/design.md) */
const C = {
  bg: '#F2F5F7',
  surface: '#FFFFFF',
  subtle: '#F6F8FA',
  line: '#E2E8EC',
  lineStrong: '#CCD5DC',
  ink: '#0F1D24',
  ink2: '#364852',
  ink3: '#66777F',
  accent: '#1F6E9C',
  accentDeep: '#123F5A',
  accentFill: '#DBEAF4',
  accentSoft: '#EDF5FA',
  gain: '#0A8A5F',
  gainFill: '#DCF3E8',
  loss: '#D23A2F',
  lossFill: '#FDE8E5',
};

type TabKey = 'home' | 'explore' | 'compose' | 'activity' | 'profile';
type FeedMode = 'newest' | 'following';
type ProfileTab = 'calls' | 'record' | 'slashes';

const API_BASE = 'http://10.0.2.2:8787'; // Android Emulator -> host localhost:8787

function timeAgo(unixSec: number): string {
  const diff = Math.max(1, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function avatarColor(pubkey: string): string {
  const palette = ['#1F6E9C', '#0F1D24', '#2E5A78', '#364852', '#123F5A'];
  const code = pubkey.charCodeAt(0) + pubkey.charCodeAt(pubkey.length - 1);
  return palette[code % palette.length];
}

function avatarInitial(pubkey: string, skr?: string | null): string {
  const label = displayIdentity(pubkey, skr);
  return label.slice(0, 1).toUpperCase();
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [feedMode, setFeedMode] = useState<FeedMode>('newest');
  const [stateFilter, setStateFilter] = useState<CallState | 'All'>('All');
  const [tokenFilter, setTokenFilter] = useState<string>('All');
  const [calls, setCalls] = useState<CallDetail[]>(
    () => JSON.parse(JSON.stringify(DEMO_CALLS)) as CallDetail[],
  );
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [selectedCaller, setSelectedCaller] = useState<CallerRecord | null>(null);
  const [callerProfileTab, setCallerProfileTab] = useState<ProfileTab>('calls');

  const [following, setFollowing] = useState<string[]>([DEMO_CALLERS[0].pubkey]);
  const [watching, setWatching] = useState<number[]>([6, 5]);
  const [replyDraft, setReplyDraft] = useState('');
  const [depositSol, setDepositSol] = useState<string>('0.25');
  const [session, setSession] = useState<SeekerSession | null>(null);
  const [busy, setBusy] = useState(false);

  // 3-Step Compose Call Thread Wizard (persisted across Android MWA Activity switches)
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [wizTokenIdx, setWizTokenIdx] = useState(0);
  const [wizStakeSol, setWizStakeSol] = useState('0.10');
  const [wizWindowMin, setWizWindowMin] = useState(5);
  const [wizTpPct, setWizTpPct] = useState(25);
  const [wizSlPct, setWizSlPct] = useState(12);
  const [wizMaxHoldMin] = useState(15);
  const [wizSharePct] = useState(5);
  const [wizThesis, setWizThesis] = useState(
    'One pooled entry on clean Devnet liquidity; strict stop-loss fixed at open.',
  );

  const visibleCalls = useMemo(() => {
    return calls.filter((c) => {
      if (feedMode === 'following' && !following.includes(c.caller)) return false;
      if (stateFilter !== 'All' && c.state !== stateFilter) return false;
      if (tokenFilter !== 'All' && c.token.symbol !== tokenFilter) return false;
      return true;
    });
  }, [calls, feedMode, following, stateFilter, tokenFilter]);

  const activeDetail: CallDetail | null = useMemo(
    () => calls.find((c) => c.callId === selectedCallId) ?? null,
    [calls, selectedCallId],
  );

  const handleConnectMwa = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      const s = await connectSeekerWallet(API_BASE);
      setSession(s);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setSession({
        pubkey: DEMO_CALLERS[1].pubkey, // rina.skr
        skrName: 'rina.skr',
        isSeekerVerified: true,
        mwaAuthToken: null,
        apiBearerToken: null,
        simulated: true,
      });
      Alert.alert(
        'Seed Vault Simulator Active',
        'Signed in as rina.skr (Seeker Genesis Verified) for live Threads walkthrough.',
      );
    } finally {
      setBusy(false);
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
    setWatching((prev) =>
      prev.includes(callId) ? prev.filter((id) => id !== callId) : [...prev, callId],
    );
  };

  const handleSeedVaultDeposit = async (call: CallDetail) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!session) {
      await handleConnectMwa();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/actions/call/${call.callId}?amount=${depositSol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: session.pubkey }),
      });
      if (res.ok && !session.simulated) {
        const { transaction } = (await res.json()) as { transaction: string };
        const sig = await signAndSendViaSeedVault(transaction, session.mwaAuthToken);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Deposited on Solana Devnet', `Signature: ${sig.slice(0, 16)}…`);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Joined via Seed Vault',
          `Committed ${depositSol} SOL into Call #${call.callId} ($${call.token.symbol}). Your replies in this thread now show "In Pool".`,
        );
      }
    } catch (err) {
      Alert.alert('Transaction Notice', err instanceof Error ? err.message : 'Unable to send');
    } finally {
      setBusy(false);
    }
  };

  const handlePostReply = async (call: CallDetail) => {
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    if (!session) {
      await handleConnectMwa();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const pos = call.positions.find((p) => p.participant === session.pubkey);
    const newReply: ThreadReply = {
      id: `rep-${call.callId}-${Date.now()}`,
      callId: call.callId,
      author: session.pubkey,
      authorSkr: session.skrName,
      authorSeekerVerified: session.isSeekerVerified,
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
      void fetch(`${API_BASE}/api/calls/${call.callId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.apiBearerToken}`,
        },
        body: JSON.stringify({ body: trimmed }),
      }).catch(() => {});
    }
  };

  const handleShareBlink = async (call: CallDetail) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `percaya Call #${call.callId} on $${call.token.symbol} by ${displayIdentity(call.caller, call.callerSkr)} — One buy, one sale, fixed rules: https://percaya.app/c/${call.callId}`,
    });
  };

  const selectedToken = DEMO_TOKENS[wizTokenIdx];
  const wizStakeLamports = BigInt(Math.max(0, Math.floor(Number(wizStakeSol || '0') * 1e9)));
  const wizImpact = impactBps(
    BigInt(selectedToken.solReserveLamports),
    wizStakeLamports,
    BigInt(selectedToken.feeBps),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" backgroundColor={C.surface} />

      {/* Threads-style Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.vesselBadge}>
            <View style={styles.vesselLine} />
          </View>
          <Text style={styles.wordmark}>percaya</Text>
          <View style={styles.seekerChip}>
            <Text style={styles.seekerChipText}>Threads · Seeker</Text>
          </View>
        </View>

        <Pressable style={styles.walletBtn} onPress={handleConnectMwa} disabled={busy}>
          <Text style={styles.walletBtnText}>
            {session ? displayIdentity(session.pubkey, session.skrName) : 'Sign in'}
          </Text>
        </Pressable>
      </View>

      {/* For You (Newest) / Following Tabs on Home */}
      {tab === 'home' && (
        <View style={styles.feedTabsBar}>
          <Pressable
            onPress={() => setFeedMode('newest')}
            style={[styles.feedTabItem, feedMode === 'newest' && styles.feedTabItemActive]}
          >
            <Text style={[styles.feedTabText, feedMode === 'newest' && styles.feedTabTextActive]}>
              For you (Newest)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFeedMode('following')}
            style={[styles.feedTabItem, feedMode === 'following' && styles.feedTabItemActive]}
          >
            <Text
              style={[styles.feedTabText, feedMode === 'following' && styles.feedTabTextActive]}
            >
              Following ({following.length})
            </Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {tab === 'home' && (
          <>
            {/* Compact Status Strip */}
            <View style={styles.filterHeader}>
              <View style={styles.segmentTrack}>
                {(['All', 'Open', 'Holding', 'Settled'] as const).map((st) => (
                  <Pressable
                    key={st}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setStateFilter(st);
                    }}
                    style={[styles.segmentItem, stateFilter === st && styles.segmentActive]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        stateFilter === st && styles.segmentTextActive,
                      ]}
                    >
                      {st}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.noRankingCaption}>Skin-in-the-game only</Text>
            </View>

            {/* Threads Feed */}
            {visibleCalls.map((call) => {
              const isWin = call.state === 'Settled' && (call.netReturnBps ?? 0) > 0;
              const isLoss = call.state === 'Settled' && (call.netReturnBps ?? 0) < 0;
              const isWatching = watching.includes(call.callId);
              const latestReply = call.replies[call.replies.length - 1];
              const tp =
                call.rules.takeProfitBps > 0
                  ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%`
                  : 'None';
              const sl = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;

              return (
                <View key={call.callId} style={styles.threadCard}>
                  {/* Left Gutter: Avatar + Vertical Thread Line */}
                  <View style={styles.threadLeftGutter}>
                    <Pressable
                      onPress={() => {
                        const found = DEMO_CALLERS.find((c) => c.pubkey === call.caller) ?? null;
                        setSelectedCaller(found);
                      }}
                      style={[styles.avatarCircle, { backgroundColor: avatarColor(call.caller) }]}
                    >
                      <Text style={styles.avatarText}>
                        {avatarInitial(call.caller, call.callerSkr)}
                      </Text>
                    </Pressable>
                    {latestReply && <View style={styles.threadConnectorLine} />}
                  </View>

                  {/* Right Content Column */}
                  <View style={styles.threadRightCol}>
                    {/* Author Header */}
                    <View style={styles.rowBetween}>
                      <Pressable
                        onPress={() => {
                          const found = DEMO_CALLERS.find((c) => c.pubkey === call.caller) ?? null;
                          setSelectedCaller(found);
                        }}
                        style={styles.rowLeft}
                      >
                        <Text style={styles.callerName}>
                          {displayIdentity(call.caller, call.callerSkr)}
                        </Text>
                        <View
                          style={[
                            styles.tierPill,
                            call.callerSeekerVerified ? styles.tierPillVerified : styles.tierPillRaw,
                          ]}
                        >
                          <Text
                            style={[
                              styles.tierPillText,
                              call.callerSeekerVerified && { color: C.accentDeep },
                            ]}
                          >
                            {call.callerSeekerVerified
                              ? `Seeker T${call.callerTier}`
                              : 'Unverified T0'}
                          </Text>
                        </View>
                        <Text style={styles.timeText}>{timeAgo(call.openedAt)}</Text>
                      </Pressable>

                      <View
                        style={[
                          styles.stateBadge,
                          call.state === 'Open' && { backgroundColor: C.accent },
                          call.state === 'Holding' && { backgroundColor: C.ink },
                        ]}
                      >
                        <Text
                          style={[
                            styles.stateBadgeText,
                            (call.state === 'Open' || call.state === 'Holding') && {
                              color: '#FFFFFF',
                            },
                          ]}
                        >
                          {call.state}
                        </Text>
                      </View>
                    </View>

                    {/* Post Thesis */}
                    <Pressable onPress={() => setSelectedCallId(call.callId)}>
                      <Text style={styles.postThesis}>{call.thesis}</Text>

                      {/* Embedded On-Chain Pool Attachment Card */}
                      <View style={styles.embeddedPoolCard}>
                        <View style={styles.rowBetween}>
                          <View style={styles.rowLeft}>
                            <Text style={styles.tokenSymbol}>${call.token.symbol}</Text>
                            <Text style={styles.callIdMuted}>Call #{call.callId}</Text>
                          </View>

                          {call.state === 'Settled' ? (
                            <Text
                              style={[
                                styles.numMedium,
                                isWin && { color: C.gain },
                                isLoss && { color: C.loss },
                              ]}
                            >
                              {formatSignedPct(call.netReturnBps)} net
                            </Text>
                          ) : call.state === 'Holding' ? (
                            <Text style={styles.numMedium}>
                              {formatSignedPct(call.liveQuoteNetBps)} quote
                            </Text>
                          ) : (
                            <Text style={styles.numMedium}>
                              {formatSolFloor(call.totalInLamports, 2)} /{' '}
                              {formatSolFloor(call.liveCapLamports, 2)} SOL
                            </Text>
                          )}
                        </View>

                        <Text style={styles.lockedNums}>
                          TP {tp} · SL {sl} · Max {Math.round(call.rules.maxHoldSec / 60)}m · Fee{' '}
                          {(call.rules.shareBps / 100).toFixed(0)}% · Fixed at open
                        </Text>
                      </View>
                    </Pressable>

                    {/* Functional Anti-Vanity Action Row */}
                    <View style={styles.actionRow}>
                      <Pressable
                        style={styles.actionBtn}
                        onPress={() => setSelectedCallId(call.callId)}
                      >
                        <Text style={styles.actionBtnText}>💬 {call.replies.length}</Text>
                      </Pressable>

                      <Pressable
                        style={[
                          styles.actionBtn,
                          call.state === 'Open' && styles.actionBtnAccent,
                        ]}
                        onPress={() => setSelectedCallId(call.callId)}
                      >
                        <Text
                          style={[
                            styles.actionBtnText,
                            call.state === 'Open' && { color: C.accentDeep, fontWeight: '700' },
                          ]}
                        >
                          {call.state === 'Open'
                            ? `⚡ Join (${call.depositorsCount})`
                            : call.state === 'Holding'
                              ? '⏱ Checkpoint'
                              : '✓ Settled'}
                        </Text>
                      </Pressable>

                      <Pressable style={styles.actionBtn} onPress={() => toggleWatch(call.callId)}>
                        <Text
                          style={[
                            styles.actionBtnText,
                            isWatching && { color: C.accent, fontWeight: '700' },
                          ]}
                        >
                          {isWatching ? '🔔 Watching' : '🔕 Watch'}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.actionBtn}
                        onPress={() => handleShareBlink(call)}
                      >
                        <Text style={styles.actionBtnText}>↗ Blink</Text>
                      </Pressable>
                    </View>

                    {/* Inline Latest Thread Reply Preview */}
                    {latestReply && (
                      <Pressable
                        onPress={() => setSelectedCallId(call.callId)}
                        style={styles.inlineReplyBox}
                      >
                        <View style={styles.rowLeft}>
                          <Text style={styles.inlineReplyAuthor}>
                            {displayIdentity(latestReply.author, latestReply.authorSkr)}
                          </Text>
                          <View
                            style={[
                              styles.skinBadge,
                              BigInt(latestReply.depositedLamports) > 0n
                                ? styles.skinBadgeIn
                                : styles.skinBadgeSpec,
                            ]}
                          >
                            <Text
                              style={[
                                styles.skinBadgeText,
                                BigInt(latestReply.depositedLamports) > 0n && {
                                  color: C.accentDeep,
                                },
                              ]}
                            >
                              {BigInt(latestReply.depositedLamports) > 0n
                                ? `In Pool · ${formatSolFloor(latestReply.depositedLamports, 2)} SOL`
                                : 'Spectator'}
                            </Text>
                          </View>
                        </View>
                        <Text numberOfLines={2} style={styles.inlineReplyBody}>
                          {latestReply.body}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {tab === 'explore' && (
          <>
            <Text style={styles.sectionTitle}>Filter by token</Text>
            <View style={styles.chipRow}>
              {['All', ...DEMO_TOKENS.map((t) => t.symbol)].map((sym) => (
                <Pressable
                  key={sym}
                  onPress={() => {
                    setTokenFilter(sym);
                    setTab('home');
                  }}
                  style={[styles.choiceChip, tokenFilter === sym && styles.choiceChipActive]}
                >
                  <Text
                    style={[
                      styles.choiceChipText,
                      tokenFilter === sym && styles.choiceChipTextActive,
                    ]}
                  >
                    {sym === 'All' ? 'All tokens' : `$${sym}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.rowBetween, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>Callers directory</Text>
              <Text style={styles.noRankingCaption}>By last activity · No ranking</Text>
            </View>
            {DEMO_CALLERS.map((c) => {
              const isFol = following.includes(c.pubkey);
              return (
                <Pressable
                  key={c.pubkey}
                  onPress={() => setSelectedCaller(c)}
                  style={styles.card}
                >
                  <View style={styles.rowBetween}>
                    <View style={styles.rowLeft}>
                      <View
                        style={[styles.avatarCircle, { backgroundColor: avatarColor(c.pubkey) }]}
                      >
                        <Text style={styles.avatarText}>
                          {avatarInitial(c.pubkey, c.skrName)}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.callerName}>
                          {displayIdentity(c.pubkey, c.skrName)}
                        </Text>
                        <Text style={styles.metricSub}>
                          {c.settled} settled · {c.losses} losses ·{' '}
                          {formatSignedPct(c.avgNetBps)} avg
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => toggleFollow(c.pubkey)}
                      style={[styles.followBtn, isFol && styles.followBtnActive]}
                    >
                      <Text style={[styles.followBtnText, isFol && { color: C.ink }]}>
                        {isFol ? 'Following' : 'Follow'}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {tab === 'compose' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>New Call Thread · Step {wizStep} of 3</Text>
            <Text style={styles.thesisSnippet}>
              Posting a call requires locking your own SOL in the pool first. Replies inside your
              thread will show who joined vs spectators.
            </Text>

            {wizStep === 1 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <Text style={styles.fieldLabel}>1. Token</Text>
                <View style={styles.chipRow}>
                  {DEMO_TOKENS.map((tok, idx) => (
                    <Pressable
                      key={tok.mint}
                      onPress={() => setWizTokenIdx(idx)}
                      style={[styles.choiceChip, wizTokenIdx === idx && styles.choiceChipActive]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          wizTokenIdx === idx && styles.choiceChipTextActive,
                        ]}
                      >
                        ${tok.symbol}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>2. Your locked SOL stake (≥5% of pool)</Text>
                <TextInput
                  value={wizStakeSol}
                  onChangeText={setWizStakeSol}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <Text style={styles.metricSub}>
                  Buy impact: {(wizImpact / 100).toFixed(2)}% (max 2.00%)
                </Text>

                <Pressable style={styles.primaryBtn} onPress={() => setWizStep(2)}>
                  <Text style={styles.primaryBtnText}>Next: Exit Rules & Thesis</Text>
                </Pressable>
              </View>
            )}

            {wizStep === 2 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <Text style={styles.fieldLabel}>Join window</Text>
                <View style={styles.chipRow}>
                  {[2, 5, 10].map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setWizWindowMin(m)}
                      style={[styles.choiceChip, wizWindowMin === m && styles.choiceChipActive]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          wizWindowMin === m && styles.choiceChipTextActive,
                        ]}
                      >
                        {m}m
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Take-profit / Stop-loss</Text>
                <View style={styles.chipRow}>
                  {[15, 25, 50].map((tp) => (
                    <Pressable
                      key={tp}
                      onPress={() => setWizTpPct(tp)}
                      style={[styles.choiceChip, wizTpPct === tp && styles.choiceChipActive]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          wizTpPct === tp && styles.choiceChipTextActive,
                        ]}
                      >
                        TP +{tp}%
                      </Text>
                    </Pressable>
                  ))}
                  {[10, 12, 20].map((sl) => (
                    <Pressable
                      key={sl}
                      onPress={() => setWizSlPct(sl)}
                      style={[styles.choiceChip, wizSlPct === sl && styles.choiceChipActive]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          wizSlPct === sl && styles.choiceChipTextActive,
                        ]}
                      >
                        SL −{sl}%
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Thread thesis (max 280 chars)</Text>
                <TextInput
                  value={wizThesis}
                  onChangeText={setWizThesis}
                  multiline
                  maxLength={280}
                  style={[styles.input, { minHeight: 76 }]}
                />

                <View style={styles.rowBetween}>
                  <Pressable style={styles.secondaryBtn} onPress={() => setWizStep(1)}>
                    <Text style={styles.secondaryBtnText}>Back</Text>
                  </Pressable>
                  <Pressable style={styles.primaryBtn} onPress={() => setWizStep(3)}>
                    <Text style={styles.primaryBtnText}>Preview Thread</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {wizStep === 3 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <View style={styles.embeddedPoolCard}>
                  <Text style={styles.callerName}>
                    ${selectedToken.symbol} · {wizStakeSol} SOL locked
                  </Text>
                  <Text style={styles.thesisSnippet}>{wizThesis}</Text>
                  <Text style={styles.lockedNums}>
                    Window {wizWindowMin}m · TP +{wizTpPct}% · SL −{wizSlPct}% · Hold{' '}
                    {wizMaxHoldMin}m · Fee {wizSharePct}%
                  </Text>
                </View>
                <View style={styles.rowBetween}>
                  <Pressable style={styles.secondaryBtn} onPress={() => setWizStep(2)}>
                    <Text style={styles.secondaryBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={styles.accentBtn}
                    onPress={() => {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert(
                        'Call Thread Published',
                        `Published $${selectedToken.symbol} thread with ${wizStakeSol} SOL locked via Seed Vault.`,
                      );
                      setWizStep(1);
                      setTab('home');
                    }}
                  >
                    <Text style={styles.primaryBtnText}>Post & Lock SOL</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {tab === 'activity' && (
          <>
            <Text style={styles.sectionTitle}>Activity</Text>
            {DEMO_ALERTS.map((al) => (
              <Pressable
                key={al.id}
                onPress={() => setSelectedCallId(al.callId)}
                style={styles.card}
              >
                <Text style={styles.callerName}>{al.title}</Text>
                <Text style={[styles.thesisSnippet, { marginTop: 4 }]}>{al.body}</Text>
              </Pressable>
            ))}
          </>
        )}

        {tab === 'profile' && (
          <>
            <View style={styles.anchorCard}>
              <Text style={styles.anchorEyebrow}>SEEKER PROFILE & CALLER BOND</Text>
              <Text style={styles.anchorTitle}>
                {session ? displayIdentity(session.pubkey, session.skrName) : 'rina.skr (Preview)'}
              </Text>
              <Text style={styles.anchorBody}>
                Seeker Genesis Token (Token-2022 NonTransferable) linked · 0.40 SOL Bond · Tier 1
                (5× cap, 10% profit-only fee).
              </Text>
              <Pressable
                style={styles.whiteOnBlueBtn}
                onPress={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert(
                    'Seeker Genesis Verified',
                    'Devnet NonTransferable Genesis NFT linked to GenesisRegistry PDA.',
                  );
                }}
              >
                <Text style={styles.whiteOnBlueBtnText}>Verify Seeker Genesis (Simulator)</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* 5-Icon Threads Bottom Navigation */}
      <View style={styles.bottomTabs}>
        {(
          [
            ['home', '⌂', 'Home'],
            ['explore', '⌕', 'Callers'],
            ['compose', '+', 'Post'],
            ['activity', '🔔', 'Activity'],
            ['profile', '☺', 'Profile'],
          ] as const
        ).map(([k, icon, label]) => (
          <Pressable
            key={k}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setTab(k);
            }}
            style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
          >
            <Text style={[styles.tabIcon, tab === k && styles.tabBtnTextActive]}>{icon}</Text>
            <Text style={[styles.tabLabel, tab === k && styles.tabBtnTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Thread Detail + Replies Modal */}
      <Modal
        visible={activeDetail !== null}
        animationType="slide"
        onRequestClose={() => setSelectedCallId(null)}
      >
        {activeDetail && (
          <SafeAreaView style={styles.safe}>
            <View style={styles.topBar}>
              <Pressable onPress={() => setSelectedCallId(null)}>
                <Text style={styles.callerName}>← Thread</Text>
              </Pressable>
              <Pressable onPress={() => handleShareBlink(activeDetail)}>
                <Text style={[styles.callerName, { color: C.accent }]}>↗ Share Blink</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.callerName}>
                    {displayIdentity(activeDetail.caller, activeDetail.callerSkr)} ·{' '}
                    {timeAgo(activeDetail.openedAt)}
                  </Text>
                  <Text style={styles.numMedium}>${activeDetail.token.symbol}</Text>
                </View>
                <Text style={[styles.postThesis, { marginTop: 8 }]}>{activeDetail.thesis}</Text>

                <View style={styles.embeddedPoolCard}>
                  <Text style={styles.lockedTitle}>
                    Pooled: {formatSolFloor(activeDetail.totalInLamports, 4)} SOL · Caller locked:{' '}
                    {formatSolFloor(activeDetail.callerStakeLamports, 4)} SOL
                  </Text>
                  <Text style={styles.lockedNums}>
                    TP +{(activeDetail.rules.takeProfitBps / 100).toFixed(0)}% · SL −
                    {(activeDetail.rules.stopLossBps / 100).toFixed(0)}% · Hold{' '}
                    {Math.round(activeDetail.rules.maxHoldSec / 60)}m · Fee{' '}
                    {(activeDetail.rules.shareBps / 100).toFixed(0)}%
                  </Text>
                </View>
              </View>

              {/* Thread Replies with Skin-in-the-Game Badges */}
              <Text style={styles.sectionTitle}>Thread ({activeDetail.replies.length})</Text>
              {activeDetail.replies.map((rep) => {
                const inPool = BigInt(rep.depositedLamports) > 0n;
                return (
                  <View key={rep.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <View style={styles.rowLeft}>
                        <Text style={styles.callerName}>
                          {displayIdentity(rep.author, rep.authorSkr)}
                        </Text>
                        <View
                          style={[
                            styles.skinBadge,
                            inPool ? styles.skinBadgeIn : styles.skinBadgeSpec,
                          ]}
                        >
                          <Text
                            style={[styles.skinBadgeText, inPool && { color: C.accentDeep }]}
                          >
                            {rep.isCaller
                              ? `Caller · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                              : inPool
                                ? `In Pool · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                                : 'Spectator'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.timeText}>{timeAgo(rep.createdAt)}</Text>
                    </View>
                    <Text style={[styles.thesisSnippet, { marginTop: 6, color: C.ink }]}>
                      {rep.body}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            {/* Bottom Reply + Seed Vault Action Dock */}
            <View style={styles.thumbDock}>
              <View style={[styles.rowBetween, { marginBottom: 10 }]}>
                <TextInput
                  value={replyDraft}
                  onChangeText={setReplyDraft}
                  placeholder="Reply to thread (auto-tagged In Pool or Spectator)…"
                  placeholderTextColor={C.ink3}
                  style={[styles.input, { flex: 1, marginRight: 8 }]}
                />
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => handlePostReply(activeDetail)}
                >
                  <Text style={styles.secondaryBtnText}>Reply</Text>
                </Pressable>
              </View>

              {activeDetail.state === 'Open' ? (
                <View style={styles.rowBetween}>
                  <TextInput
                    value={depositSol}
                    onChangeText={setDepositSol}
                    keyboardType="decimal-pad"
                    style={[styles.input, { width: 92, marginRight: 8 }]}
                  />
                  <Pressable
                    style={[styles.accentBtn, { flex: 1 }]}
                    onPress={() => handleSeedVaultDeposit(activeDetail)}
                  >
                    <Text style={styles.primaryBtnText}>Join via Seed Vault (SOL)</Text>
                  </Pressable>
                </View>
              ) : activeDetail.state === 'Holding' ? (
                <View style={styles.rowBetween}>
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1, marginRight: 8 }]}
                    onPress={() =>
                      Alert.alert('Checkpoint Recorded', 'Recorded live AMM sell quote on chain.')
                    }
                  >
                    <Text style={styles.secondaryBtnText}>Checkpoint</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.accentBtn, { flex: 1 }]}
                    onPress={() =>
                      Alert.alert(
                        'Keeper Sale Check',
                        'Requires 2 checkpoints ≥45s apart meeting TP/SL or Max Hold.',
                      )
                    }
                  >
                    <Text style={styles.primaryBtnText}>Sell & Earn 0.1%</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() =>
                    Alert.alert('Claimed via Seed Vault', 'Pro-rata SOL transferred from SolVault.')
                  }
                >
                  <Text style={styles.primaryBtnText}>Claim Pro-Rata SOL</Text>
                </Pressable>
              )}
            </View>
          </SafeAreaView>
        )}
      </Modal>

      {/* Threads-Style Caller Profile Modal (Calls · Record · Slashes) */}
      <Modal
        visible={selectedCaller !== null}
        animationType="slide"
        onRequestClose={() => setSelectedCaller(null)}
      >
        {selectedCaller && (
          <SafeAreaView style={styles.safe}>
            <View style={styles.topBar}>
              <Pressable onPress={() => setSelectedCaller(null)}>
                <Text style={styles.callerName}>← Back</Text>
              </Pressable>
              <Pressable
                onPress={() => toggleFollow(selectedCaller.pubkey)}
                style={[
                  styles.followBtn,
                  following.includes(selectedCaller.pubkey) && styles.followBtnActive,
                ]}
              >
                <Text style={styles.followBtnText}>
                  {following.includes(selectedCaller.pubkey) ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={styles.sectionTitle}>
                      {displayIdentity(selectedCaller.pubkey, selectedCaller.skrName)}
                    </Text>
                    <Text style={styles.metricSub}>{selectedCaller.tierInfo.reason}</Text>
                  </View>
                  <View
                    style={[
                      styles.avatarCircle,
                      { width: 46, height: 46, borderRadius: 23, backgroundColor: avatarColor(selectedCaller.pubkey) },
                    ]}
                  >
                    <Text style={[styles.avatarText, { fontSize: 18 }]}>
                      {avatarInitial(selectedCaller.pubkey, selectedCaller.skrName)}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.metricSub, { marginTop: 10 }]}>
                  Bond: {formatSolFloor(selectedCaller.bondLamports, 2)} SOL ·{' '}
                  {selectedCaller.settled} settled · Avg{' '}
                  {formatSignedPct(selectedCaller.avgNetBps)}
                </Text>
              </View>

              <View style={styles.feedTabsBar}>
                {(['calls', 'record', 'slashes'] as const).map((pt) => (
                  <Pressable
                    key={pt}
                    onPress={() => setCallerProfileTab(pt)}
                    style={[styles.feedTabItem, callerProfileTab === pt && styles.feedTabItemActive]}
                  >
                    <Text
                      style={[
                        styles.feedTabText,
                        callerProfileTab === pt && styles.feedTabTextActive,
                      ]}
                    >
                      {pt.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {callerProfileTab === 'calls' &&
                calls
                  .filter((c) => c.caller === selectedCaller.pubkey)
                  .map((c) => (
                    <Pressable
                      key={c.callId}
                      onPress={() => {
                        setSelectedCaller(null);
                        setSelectedCallId(c.callId);
                      }}
                      style={styles.card}
                    >
                      <Text style={styles.callerName}>
                        ${c.token.symbol} · {c.state}{' '}
                        {c.state === 'Settled' ? formatSignedPct(c.netReturnBps) : ''}
                      </Text>
                      <Text style={styles.thesisSnippet}>{c.thesis}</Text>
                    </Pressable>
                  ))}

              {callerProfileTab === 'record' && (
                <View style={styles.card}>
                  <Text style={styles.numMedium}>
                    Settled: {selectedCaller.settled} · Losses: {selectedCaller.losses} · Negligent:{' '}
                    {selectedCaller.negligent} · Slashes: {selectedCaller.slashes}
                  </Text>
                </View>
              )}

              {callerProfileTab === 'slashes' &&
                (selectedCaller.slashHistory.length === 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.metricSub}>Zero slashes on record.</Text>
                  </View>
                ) : (
                  selectedCaller.slashHistory.map((s) => (
                    <View key={s.txSig} style={[styles.card, { backgroundColor: C.lossFill }]}>
                      <Text style={[styles.callerName, { color: C.loss }]}>
                        Slashed {formatSolFloor(s.amountLamports, 2)} SOL
                      </Text>
                      <Text style={[styles.thesisSnippet, { color: C.ink }]}>{s.reason}</Text>
                    </View>
                  ))
                ))}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topBar: {
    height: 54,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vesselBadge: {
    width: 22,
    height: 20,
    borderWidth: 1.8,
    borderColor: C.ink,
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  vesselLine: { height: 2.2, backgroundColor: C.accent, width: '100%' },
  wordmark: { fontSize: 18, fontWeight: '700', color: C.ink, letterSpacing: -0.4 },
  seekerChip: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
  },
  seekerChipText: { fontSize: 11, fontWeight: '600', color: C.accentDeep },
  walletBtn: {
    backgroundColor: C.ink,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  walletBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  feedTabsBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  feedTabItem: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  feedTabItemActive: { borderBottomWidth: 2, borderBottomColor: C.ink },
  feedTabText: { fontSize: 13, fontWeight: '500', color: C.ink3 },
  feedTabTextActive: { color: C.ink, fontWeight: '700' },
  scrollContent: { padding: 12, gap: 10, paddingBottom: 28 },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: C.line,
  },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  segmentActive: { backgroundColor: C.accentFill },
  segmentText: { fontSize: 12, fontWeight: '500', color: C.ink2 },
  segmentTextActive: { color: C.accentDeep, fontWeight: '600' },
  noRankingCaption: { fontSize: 11, color: C.ink3 },
  threadCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    flexDirection: 'row',
    gap: 11,
  },
  threadLeftGutter: { alignItems: 'center', width: 38 },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  threadConnectorLine: {
    width: 2,
    flex: 1,
    backgroundColor: C.line,
    marginTop: 6,
    borderRadius: 1,
  },
  threadRightCol: { flex: 1, gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  callerName: { fontSize: 14, fontWeight: '600', color: C.ink },
  timeText: { fontSize: 12, color: C.ink3 },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  tierPillVerified: { backgroundColor: C.accentSoft },
  tierPillRaw: { backgroundColor: C.subtle, borderWidth: 1, borderColor: C.line },
  tierPillText: { fontSize: 10, fontWeight: '600', color: C.ink3 },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: C.subtle,
  },
  stateBadgeText: { fontSize: 11, fontWeight: '600', color: C.ink2 },
  postThesis: { fontSize: 14, color: C.ink, lineHeight: 20 },
  embeddedPoolCard: {
    marginTop: 6,
    backgroundColor: C.subtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    padding: 10,
    gap: 4,
  },
  tokenSymbol: { fontSize: 15, fontWeight: '700', color: C.ink },
  callIdMuted: { fontSize: 12, color: C.ink3 },
  numMedium: {
    fontSize: 13,
    fontWeight: '700',
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
  lockedTitle: { fontSize: 12, fontWeight: '600', color: C.ink },
  lockedNums: { fontSize: 11, color: C.ink2, fontVariant: ['tabular-nums'] },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  actionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: C.subtle,
  },
  actionBtnAccent: { backgroundColor: C.accentFill },
  actionBtnText: { fontSize: 12, color: C.ink2, fontWeight: '500' },
  inlineReplyBox: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
    gap: 3,
  },
  inlineReplyAuthor: { fontSize: 12, fontWeight: '600', color: C.ink },
  inlineReplyBody: { fontSize: 12, color: C.ink2, lineHeight: 17 },
  skinBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  skinBadgeIn: { backgroundColor: C.accentSoft },
  skinBadgeSpec: { backgroundColor: C.subtle, borderWidth: 1, borderColor: C.line },
  skinBadgeText: { fontSize: 10, fontWeight: '600', color: C.ink3, fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
  },
  anchorCard: {
    backgroundColor: C.accent,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  anchorEyebrow: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  anchorTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  anchorBody: { color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 19 },
  whiteOnBlueBtn: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  whiteOnBlueBtnText: { color: C.ink, fontSize: 13, fontWeight: '600' },
  followBtn: {
    backgroundColor: C.ink,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
  },
  followBtnActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  followBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.ink2 },
  thesisSnippet: { fontSize: 13, color: C.ink2, lineHeight: 18 },
  metricSub: { fontSize: 11, color: C.ink3, fontVariant: ['tabular-nums'] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.surface,
  },
  choiceChipActive: { backgroundColor: C.accentFill, borderColor: C.accent },
  choiceChipText: { fontSize: 13, fontWeight: '500', color: C.ink2 },
  choiceChipTextActive: { color: C.accentDeep, fontWeight: '700' },
  input: {
    backgroundColor: C.subtle,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: C.ink,
  },
  primaryBtn: {
    backgroundColor: C.ink,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  accentBtn: {
    backgroundColor: C.accent,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: C.ink, fontSize: 13, fontWeight: '600' },
  bottomTabs: {
    height: 60,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: C.accentSoft },
  tabIcon: { fontSize: 17, color: C.ink2, fontWeight: '600' },
  tabLabel: { fontSize: 10, color: C.ink3, fontWeight: '500', marginTop: 1 },
  tabBtnTextActive: { color: C.accentDeep, fontWeight: '700' },
  thumbDock: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    padding: 12,
  },
});
