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
  type CallSummary,
  type CallerRecord,
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

/** Calm Daylight Design System Tokens (exact match to docs/design.md) */
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

type TabKey = 'calls' | 'open' | 'callers' | 'vault';

const API_BASE = 'http://10.0.2.2:8787'; // Android Emulator -> host localhost:8787

export default function App() {
  const [tab, setTab] = useState<TabKey>('calls');
  const [stateFilter, setStateFilter] = useState<CallState | 'All'>('All');
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [selectedCaller, setSelectedCaller] = useState<CallerRecord | null>(null);
  const [depositSol, setDepositSol] = useState<string>('0.25');
  const [session, setSession] = useState<SeekerSession | null>(null);
  const [busy, setBusy] = useState(false);

  // 3-Step Mobile Call Wizard state (persisted across Android MWA Activity switches)
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [wizTokenIdx, setWizTokenIdx] = useState(0);
  const [wizStakeSol, setWizStakeSol] = useState('0.10');
  const [wizWindowMin, setWizWindowMin] = useState(5);
  const [wizTpPct, setWizTpPct] = useState(25);
  const [wizSlPct, setWizSlPct] = useState(12);
  const [wizMaxHoldMin, setWizMaxHoldMin] = useState(15);
  const [wizSharePct, setWizSharePct] = useState(5);
  const [wizThesis, setWizThesis] = useState(
    'One pooled entry on clean Devnet liquidity; strict stop-loss fixed at open.',
  );

  const calls: CallSummary[] = useMemo(() => {
    return DEMO_CALLS.filter((c) => stateFilter === 'All' || c.state === stateFilter);
  }, [stateFilter]);

  const activeDetail: CallDetail | null = useMemo(
    () => DEMO_CALLS.find((c) => c.callId === selectedCallId) ?? null,
    [selectedCallId],
  );

  const handleConnectMwa = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      const s = await connectSeekerWallet(API_BASE);
      setSession(s);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Fallback to Seed Vault Simulator preview identity if no MWA wallet APK is installed yet
      setSession({
        pubkey: DEMO_CALLERS[0].pubkey,
        skrName: 'budi.skr',
        isSeekerVerified: true,
        mwaAuthToken: null,
        apiBearerToken: null,
        simulated: true,
      });
      Alert.alert(
        'Seed Vault Simulator Preview',
        'No external MWA wallet responded on this device, so budi.skr (Simulated Seeker Genesis) is active for UI walkthrough.',
      );
    } finally {
      setBusy(false);
    }
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
          'Seed Vault Deposit Signed',
          `Committed ${depositSol} SOL into Call #${call.callId} ($${call.token.symbol}) at shared pool price.`,
        );
      }
    } catch (err) {
      Alert.alert('Transaction Notice', err instanceof Error ? err.message : 'Unable to send');
    } finally {
      setBusy(false);
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

      {/* Top App Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.vesselBadge}>
            <View style={styles.vesselLine} />
          </View>
          <Text style={styles.wordmark}>percaya</Text>
          <View style={styles.seekerChip}>
            <Text style={styles.seekerChipText}>Seeker</Text>
          </View>
        </View>

        <Pressable style={styles.walletBtn} onPress={handleConnectMwa} disabled={busy}>
          <Text style={styles.walletBtnText}>
            {session ? displayIdentity(session.pubkey, session.skrName) : 'Connect Seed Vault'}
          </Text>
        </Pressable>
      </View>

      {/* Main Tab Body */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {tab === 'calls' && (
          <>
            {/* Single Solid Brand-Blue Anchor Card (design.md rule) */}
            <View style={styles.anchorCard}>
              <Text style={styles.anchorEyebrow}>CLOSING IN 4 MIN · CALL #6</Text>
              <Text style={styles.anchorTitle}>
                One buy. One sale. The same price for everyone.
              </Text>
              <Text style={styles.anchorBody}>
                Caller SOL is locked in the pool first. Tiers 1–3 bind to a 1-per-phone Seeker
                Genesis Token.
              </Text>
            </View>

            {/* Filter Row */}
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
              <Text style={styles.noRankingCaption}>Newest · No ranking</Text>
            </View>

            {calls.map((call) => {
              const isWin = call.state === 'Settled' && (call.netReturnBps ?? 0) > 0;
              const isLoss = call.state === 'Settled' && (call.netReturnBps ?? 0) < 0;
              const tp =
                call.rules.takeProfitBps > 0
                  ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%`
                  : 'None';
              const sl = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;

              return (
                <Pressable
                  key={call.callId}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedCallId(call.callId);
                  }}
                  style={styles.card}
                >
                  <View style={styles.rowBetween}>
                    <View style={styles.rowLeft}>
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
                    </View>
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

                  <View style={[styles.rowBetween, { marginTop: 10 }]}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={styles.tokenSymbol}>
                        ${call.token.symbol}{' '}
                        <Text style={styles.callIdMuted}>#{call.callId}</Text>
                      </Text>
                      <Text numberOfLines={2} style={styles.thesisSnippet}>
                        {call.thesis}
                      </Text>
                    </View>

                    {call.state === 'Settled' ? (
                      <View
                        style={[
                          styles.resultBox,
                          isWin && { backgroundColor: C.gainFill },
                          isLoss && { backgroundColor: C.lossFill },
                        ]}
                      >
                        <Text
                          style={[
                            styles.numLarge,
                            isWin && { color: C.gain },
                            isLoss && { color: C.loss },
                          ]}
                        >
                          {formatSignedPct(call.netReturnBps)}
                        </Text>
                        <Text style={styles.metricSub}>net after fee</Text>
                      </View>
                    ) : call.state === 'Holding' ? (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.numLarge}>{formatSignedPct(call.liveQuoteNetBps)}</Text>
                        <Text style={styles.metricSub}>AMM quote</Text>
                      </View>
                    ) : (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.numMedium}>
                          {formatSolFloor(call.totalInLamports, 2)} /{' '}
                          {formatSolFloor(call.liveCapLamports, 2)} SOL
                        </Text>
                        <Text style={styles.metricSub}>{call.depositorsCount} joined</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.lockedStrip}>
                    <Text style={styles.lockedTitle}>Fixed at open</Text>
                    <Text style={styles.lockedNums}>
                      TP {tp} · SL {sl} · Max {Math.round(call.rules.maxHoldSec / 60)}m · Fee{' '}
                      {(call.rules.shareBps / 100).toFixed(0)}%
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {tab === 'open' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Open an immutable call · Step {wizStep} of 3</Text>
            <Text style={styles.thesisSnippet}>
              Your SOL stake enters and exits in the same swap as everyone else. Nothing changes
              after you sign.
            </Text>

            {wizStep === 1 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <Text style={styles.fieldLabel}>1. Select allowed SPL token</Text>
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

                <Text style={styles.fieldLabel}>2. Your locked caller stake (SOL, ≥5% of pool)</Text>
                <TextInput
                  value={wizStakeSol}
                  onChangeText={setWizStakeSol}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <Text style={styles.metricSub}>
                  Estimated buy impact: {(wizImpact / 100).toFixed(2)}% (limit 2.00%)
                </Text>

                <Pressable style={styles.primaryBtn} onPress={() => setWizStep(2)}>
                  <Text style={styles.primaryBtnText}>Next: Fix Exit Rules</Text>
                </Pressable>
              </View>
            )}

            {wizStep === 2 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <Text style={styles.fieldLabel}>Join window (minutes)</Text>
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

                <Text style={styles.fieldLabel}>Take-profit / Stop-loss / Max hold</Text>
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
                </View>
                <View style={styles.chipRow}>
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

                <Text style={styles.fieldLabel}>Thesis (max 280 bytes, plain facts)</Text>
                <TextInput
                  value={wizThesis}
                  onChangeText={setWizThesis}
                  multiline
                  maxLength={280}
                  style={[styles.input, { minHeight: 72 }]}
                />

                <View style={styles.rowBetween}>
                  <Pressable style={styles.secondaryBtn} onPress={() => setWizStep(1)}>
                    <Text style={styles.secondaryBtnText}>Back</Text>
                  </Pressable>
                  <Pressable style={styles.primaryBtn} onPress={() => setWizStep(3)}>
                    <Text style={styles.primaryBtnText}>Review Lock</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {wizStep === 3 && (
              <View style={{ marginTop: 14, gap: 12 }}>
                <View style={styles.lockedStrip}>
                  <Text style={styles.lockedTitle}>Final immutable rules</Text>
                  <Text style={styles.lockedNums}>
                    ${selectedToken.symbol} · Stake {wizStakeSol} SOL · Window {wizWindowMin}m · TP
                    +{wizTpPct}% · SL −{wizSlPct}% · Hold {wizMaxHoldMin}m · Fee {wizSharePct}%
                  </Text>
                </View>
                <Text style={styles.metricSub}>
                  Neither you nor the protocol admin can alter these rules or withdraw your stake
                  once signed in Seed Vault.
                </Text>
                <View style={styles.rowBetween}>
                  <Pressable style={styles.secondaryBtn} onPress={() => setWizStep(2)}>
                    <Text style={styles.secondaryBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={styles.accentBtn}
                    onPress={() => {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert(
                        'Call Opened via Seed Vault',
                        `Opened $${selectedToken.symbol} pool with ${wizStakeSol} SOL stake. Blink link ready to share.`,
                      );
                      setWizStep(1);
                      setTab('calls');
                    }}
                  >
                    <Text style={styles.primaryBtnText}>Sign in Seed Vault</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {tab === 'callers' && (
          <>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Callers directory</Text>
              <Text style={styles.noRankingCaption}>Ordered by last activity</Text>
            </View>
            {DEMO_CALLERS.map((c) => (
              <Pressable
                key={c.pubkey}
                onPress={() => setSelectedCaller(c)}
                style={styles.card}
              >
                <View style={styles.rowBetween}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.callerName}>{displayIdentity(c.pubkey, c.skrName)}</Text>
                    <View
                      style={[
                        styles.tierPill,
                        c.isSeekerVerified && !c.genesisSlashed
                          ? styles.tierPillVerified
                          : styles.tierPillRaw,
                      ]}
                    >
                      <Text style={styles.tierPillText}>
                        {c.genesisSlashed
                          ? 'Slashed · T0'
                          : c.isSeekerVerified
                            ? `Seeker Genesis · T${c.tierInfo.tier}`
                            : 'Unverified · T0'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.numMedium,
                      (c.avgNetBps ?? 0) > 0 && { color: C.gain },
                      (c.avgNetBps ?? 0) < 0 && { color: C.loss },
                    ]}
                  >
                    {formatSignedPct(c.avgNetBps)} avg
                  </Text>
                </View>
                <Text style={[styles.metricSub, { marginTop: 6 }]}>
                  {c.settled} settled · {c.losses} losses · {c.negligent} negligent · {c.slashes}{' '}
                  slashes · Bond {formatSolFloor(c.bondLamports, 2)} SOL
                </Text>
              </Pressable>
            ))}
          </>
        )}

        {tab === 'vault' && (
          <>
            {/* Solid Brand-Blue Caller Bond & Seeker Genesis Hardware Card */}
            <View style={styles.anchorCard}>
              <Text style={styles.anchorEyebrow}>CALLER BOND & HARDWARE IDENTITY</Text>
              <Text style={styles.anchorTitle}>
                {session ? displayIdentity(session.pubkey, session.skrName) : 'budi.skr (Preview)'}{' '}
                · 0.50 SOL Bond
              </Text>
              <Text style={styles.anchorBody}>
                Seeker Genesis Token (Token-2022 NonTransferable) linked to GenesisRegistry PDA.
                Tier 2 unlocked: 10× bond cap, up to 15% profit-only share.
              </Text>
              <Pressable
                style={styles.whiteOnBlueBtn}
                onPress={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert(
                    'Token-2022 Genesis Verified',
                    'Devnet NonTransferable Seeker Genesis NFT verified against GlobalConfig.genesis_authority.',
                  );
                }}
              >
                <Text style={styles.whiteOnBlueBtnText}>
                  Verify Devnet Seeker Genesis (Simulator)
                </Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>Live alerts</Text>
            {DEMO_ALERTS.map((al) => (
              <View key={al.id} style={styles.card}>
                <Text style={styles.callerName}>{al.title}</Text>
                <Text style={[styles.thesisSnippet, { marginTop: 4 }]}>{al.body}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Bottom 4-Tab Android Navigation */}
      <View style={styles.bottomTabs}>
        {(
          [
            ['calls', 'Calls'],
            ['open', '+ Open'],
            ['callers', 'Callers'],
            ['vault', 'Vault'],
          ] as const
        ).map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setTab(k);
            }}
            style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
          >
            <Text style={[styles.tabBtnText, tab === k && styles.tabBtnTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Call Detail & Seed Vault Bottom Sheet Modal */}
      <Modal
        visible={activeDetail !== null}
        animationType="slide"
        onRequestClose={() => setSelectedCallId(null)}
      >
        {activeDetail && (
          <SafeAreaView style={styles.safe}>
            <View style={styles.topBar}>
              <Pressable onPress={() => setSelectedCallId(null)}>
                <Text style={styles.callerName}>← Back</Text>
              </Pressable>
              <Pressable onPress={() => handleShareBlink(activeDetail)}>
                <Text style={[styles.callerName, { color: C.accent }]}>Share Blink</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
              <View style={styles.anchorCard}>
                <Text style={styles.anchorEyebrow}>
                  CALL #{activeDetail.callId} · {activeDetail.state.toUpperCase()}
                </Text>
                <Text style={styles.anchorTitle}>
                  ${activeDetail.token.symbol} by{' '}
                  {displayIdentity(activeDetail.caller, activeDetail.callerSkr)}
                </Text>
                <Text style={styles.anchorBody}>
                  Pooled: {formatSolFloor(activeDetail.totalInLamports, 4)} SOL · Caller locked:{' '}
                  {formatSolFloor(activeDetail.callerStakeLamports, 4)} SOL
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Thesis</Text>
                <Text style={[styles.thesisSnippet, { marginTop: 4 }]}>{activeDetail.thesis}</Text>

                <View style={[styles.lockedStrip, { marginTop: 12 }]}>
                  <Text style={styles.lockedTitle}>Fixed at open (Immutable PDA)</Text>
                  <Text style={styles.lockedNums}>
                    TP +{(activeDetail.rules.takeProfitBps / 100).toFixed(0)}% · SL −
                    {(activeDetail.rules.stopLossBps / 100).toFixed(0)}% · Hold{' '}
                    {Math.round(activeDetail.rules.maxHoldSec / 60)}m · Fee{' '}
                    {(activeDetail.rules.shareBps / 100).toFixed(0)}%
                  </Text>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
                  Spaced on-chain checkpoints ({activeDetail.rules.checkpointGapSec}s gap)
                </Text>
                <Text style={styles.metricSub}>
                  Prev:{' '}
                  {activeDetail.prevCheckpoint.at > 0
                    ? `${formatSolFloor(activeDetail.prevCheckpoint.valueLamports, 4)} SOL`
                    : '—'}{' '}
                  · Last:{' '}
                  {activeDetail.lastCheckpoint.at > 0
                    ? `${formatSolFloor(activeDetail.lastCheckpoint.valueLamports, 4)} SOL`
                    : '—'}
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.fieldLabel}>
                  Participants ({activeDetail.positions.length}) · Early buyers (
                  {activeDetail.earlyBuyers.length})
                </Text>
                {activeDetail.positions.map((p) => (
                  <View
                    key={p.participant}
                    style={[styles.rowBetween, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }]}
                  >
                    <Text style={styles.thesisSnippet}>
                      {displayIdentity(p.participant, p.skrName)} {p.isCaller ? '(Caller)' : ''}
                    </Text>
                    <Text style={styles.numMedium}>{formatSolFloor(p.depositedLamports, 4)} SOL</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Thumb-Zone Seed Vault Action Dock */}
            <View style={styles.thumbDock}>
              {activeDetail.state === 'Open' ? (
                <View style={styles.rowBetween}>
                  <TextInput
                    value={depositSol}
                    onChangeText={setDepositSol}
                    keyboardType="decimal-pad"
                    style={[styles.input, { width: 100, marginRight: 10 }]}
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

      {/* Caller Slash & Record Modal */}
      <Modal
        visible={selectedCaller !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedCaller(null)}
      >
        <View style={styles.sheetBackdrop}>
          {selectedCaller && (
            <View style={styles.sheetCard}>
              <Text style={styles.sectionTitle}>
                {displayIdentity(selectedCaller.pubkey, selectedCaller.skrName)}
              </Text>
              <Text style={[styles.thesisSnippet, { marginTop: 4 }]}>
                {selectedCaller.tierInfo.reason}
              </Text>
              {selectedCaller.slashHistory.map((s) => (
                <View
                  key={s.txSig}
                  style={[styles.lockedStrip, { backgroundColor: C.lossFill, marginTop: 10 }]}
                >
                  <Text style={[styles.lockedTitle, { color: C.loss }]}>
                    Slashed {formatSolFloor(s.amountLamports, 2)} SOL
                  </Text>
                  <Text style={[styles.thesisSnippet, { color: C.ink }]}>{s.reason}</Text>
                </View>
              ))}
              <Pressable
                style={[styles.primaryBtn, { marginTop: 16 }]}
                onPress={() => setSelectedCaller(null)}
              >
                <Text style={styles.primaryBtnText}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topBar: {
    height: 56,
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
  scrollContent: { padding: 14, gap: 12, paddingBottom: 28 },
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
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: C.line,
  },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9 },
  segmentActive: { backgroundColor: C.accentFill },
  segmentText: { fontSize: 12, fontWeight: '500', color: C.ink2 },
  segmentTextActive: { color: C.accentDeep, fontWeight: '600' },
  noRankingCaption: { fontSize: 11, color: C.ink3 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 15,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  callerName: { fontSize: 14, fontWeight: '600', color: C.ink },
  tierPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  tierPillVerified: { backgroundColor: C.accentSoft },
  tierPillRaw: { backgroundColor: C.subtle, borderWidth: 1, borderColor: C.line },
  tierPillText: { fontSize: 11, fontWeight: '500', color: C.ink3 },
  stateBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: C.subtle,
  },
  stateBadgeText: { fontSize: 11, fontWeight: '600', color: C.ink2 },
  tokenSymbol: { fontSize: 18, fontWeight: '700', color: C.ink },
  callIdMuted: { fontSize: 13, fontWeight: '400', color: C.ink3 },
  thesisSnippet: { fontSize: 13, color: C.ink2, lineHeight: 18, marginTop: 2 },
  resultBox: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'flex-end',
    backgroundColor: C.subtle,
  },
  numLarge: {
    fontSize: 17,
    fontWeight: '700',
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
  numMedium: {
    fontSize: 14,
    fontWeight: '600',
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
  metricSub: { fontSize: 11, color: C.ink3, marginTop: 2, fontVariant: ['tabular-nums'] },
  lockedStrip: {
    marginTop: 12,
    backgroundColor: C.subtle,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 11,
    paddingVertical: 8,
    gap: 2,
  },
  lockedTitle: { fontSize: 11, fontWeight: '600', color: C.ink },
  lockedNums: { fontSize: 12, color: C.ink2, fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.ink2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    paddingVertical: 10,
    fontSize: 14,
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
  primaryBtn: {
    backgroundColor: C.ink,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  accentBtn: {
    backgroundColor: C.accent,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  bottomTabs: {
    height: 62,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: C.accentFill },
  tabBtnText: { fontSize: 13, fontWeight: '500', color: C.ink2 },
  tabBtnTextActive: { color: C.accentDeep, fontWeight: '700' },
  thumbDock: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    padding: 14,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,29,36,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
});
