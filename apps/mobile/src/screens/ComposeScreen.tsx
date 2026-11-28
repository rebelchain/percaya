import {
  formatSolFloor,
  impactBps,
  LAMPORTS_PER_SOL_N,
  maxImpactSol,
  quoteBuy,
  type CallerRecord,
  type TokenInfo,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Lock,
  QrCode,
  Share2,
  ShieldCheck,
  Wallet,
} from '../components/ui/icons';
import {
  PrimaryButton,
  RuleChip,
  SecondaryButton,
  SegmentedProgress,
} from '../components/ui/primitives';

export interface PublishedCallReceipt {
  callId: number;
  symbol: string;
  stakeSol: string;
  txSig: string;
}

export interface ComposeScreenProps {
  tokens: TokenInfo[];
  step: 1 | 2 | 3;
  onChangeStep: (step: 1 | 2 | 3) => void;
  tokenIdx: number;
  onChangeTokenIdx: (idx: number) => void;
  stakeSol: string;
  onChangeStakeSol: (val: string) => void;
  windowMin: number;
  onChangeWindowMin: (min: number) => void;
  tpPct: number;
  onChangeTpPct: (pct: number) => void;
  slPct: number;
  onChangeSlPct: (pct: number) => void;
  maxHoldMin: number;
  onChangeMaxHoldMin: (min: number) => void;
  sharePct: number;
  onChangeSharePct: (pct: number) => void;
  thesis: string;
  onChangeThesis: (val: string) => void;
  connected: boolean;
  balanceSol: number | null;
  myCallerRecord: CallerRecord | null;
  isSeekerVerified: boolean;
  busy: boolean;
  submitError: string | null;
  publishedReceipt: PublishedCallReceipt | null;
  onClearReceipt: () => void;
  onConnect: () => void;
  onPublish: () => void;
  onSharePublished: (callId: number) => void;
  onShowQrPublished: (callId: number) => void;
  onViewPublishedThread: (callId: number) => void;
}

const STAKE_PRESETS = ['0.005', '0.01', '0.1', '0.5', '1'];

export function ComposeScreen({
  tokens,
  step,
  onChangeStep,
  tokenIdx,
  onChangeTokenIdx,
  stakeSol,
  onChangeStakeSol,
  windowMin,
  onChangeWindowMin,
  tpPct,
  onChangeTpPct,
  slPct,
  onChangeSlPct,
  maxHoldMin,
  onChangeMaxHoldMin,
  sharePct,
  onChangeSharePct,
  thesis,
  onChangeThesis,
  connected,
  balanceSol,
  myCallerRecord,
  isSeekerVerified,
  busy,
  submitError,
  publishedReceipt,
  onClearReceipt,
  onConnect,
  onPublish,
  onSharePublished,
  onShowQrPublished,
  onViewPublishedThread,
}: ComposeScreenProps) {
  const { colors } = useTheme();
  const [impactExpanded, setImpactExpanded] = useState(false);
  const [customRulesOpen, setCustomRulesOpen] = useState(false);

  const selectedToken = tokens[tokenIdx] ?? tokens[0];
  const parsedStake = Math.max(0, Number(stakeSol || '0') || 0);
  const stakeLamports = BigInt(Math.floor(parsedStake * Number(LAMPORTS_PER_SOL_N)));

  const solRes = BigInt(selectedToken?.solReserveLamports ?? '0');
  const tokRes = BigInt(selectedToken?.tokenReserveAtoms ?? '0');
  const feeBps = BigInt(selectedToken?.feeBps ?? 30);

  const max2PctLamports = useMemo(
    () => maxImpactSol(solRes, 200n, feeBps),
    [solRes, feeBps],
  );
  const max2PctSol = Number(max2PctLamports) / 1e9;

  const tier = myCallerRecord?.tierInfo.tier ?? 0;
  const bondMultiple = myCallerRecord?.tierInfo.bondMultiple ?? 2;
  const maxSharePct = (myCallerRecord?.tierInfo.maxShareBps ?? 500) / 100;
  const existingBondSol = Number(BigInt(myCallerRecord?.bondLamports ?? '0')) / 1e9;
  const needsBondSol = Math.max(0, 0.05 - existingBondSol);
  const effectiveBondSol = Math.max(0.05, existingBondSol);
  const bondCapSol = effectiveBondSol * bondMultiple;

  const impact = useMemo(
    () => impactBps(solRes, stakeLamports, feeBps),
    [solRes, stakeLamports, feeBps],
  );
  const impactPct = impact / 100;
  const estTokensOut = useMemo(
    () => quoteBuy(solRes, tokRes, stakeLamports, feeBps),
    [solRes, tokRes, stakeLamports, feeBps],
  );

  const impactTone =
    impact <= 100
      ? { bg: colors.gainFill, fg: colors.gainText, label: 'Low impact' }
      : impact <= 200
        ? { bg: colors.holdingFill, fg: colors.holdingText, label: 'Near 2% cap' }
        : { bg: colors.lossFill, fg: colors.lossText, label: 'Exceeds 2% cap' };

  const stakeExceedsImpact = impact > 200;
  const stakeExceedsTierCap = parsedStake > bondCapSol + 1e-6;
  const step1Valid = parsedStake > 0 && !stakeExceedsImpact && !stakeExceedsTierCap;
  const step2Valid =
    thesis.trim().length >= 4 &&
    thesis.length <= 280 &&
    slPct >= 1 &&
    slPct <= 90 &&
    tpPct >= 1 &&
    tpPct <= 500;

  const handlePressMax = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const poolSafe = Math.max(0.001, Math.floor(max2PctSol * 0.96 * 10000) / 10000);
    const tierSafe = bondCapSol;
    const walletSafe =
      balanceSol !== null
        ? Math.max(0.001, balanceSol - needsBondSol - 0.006)
        : poolSafe;
    const best = Math.min(poolSafe, tierSafe, walletSafe);
    onChangeStakeSol(best.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  };

  if (publishedReceipt) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={s.scrollContent}
      >
        <View
          style={[
            s.card,
            SHADOWS.card,
            { backgroundColor: colors.surface, borderColor: colors.line, alignItems: 'center' },
          ]}
        >
          <View style={[s.successCircle, { backgroundColor: colors.gainFill }]}>
            <CheckCircle2 size={28} color={colors.gain} strokeWidth={2.2} />
          </View>
          <Text style={[TYPE.display, { color: colors.ink, textAlign: 'center' }]}>
            Call #{publishedReceipt.callId} is Live
          </Text>
          <Text style={[TYPE.body, { color: colors.ink2, textAlign: 'center' }]}>
            Locked {publishedReceipt.stakeSol} SOL on ${publishedReceipt.symbol}. Followers can now
            join at the exact same entry price before the window closes.
          </Text>

          <View style={s.rulesRowCenter}>
            <RuleChip kind="tp" label={`TP +${tpPct}%`} />
            <RuleChip kind="sl" label={`SL −${slPct}%`} />
            <RuleChip kind="time" label={`Max ${maxHoldMin}m`} />
          </View>

          <View style={{ width: '100%', gap: SPACING.sm, marginTop: SPACING.xs }}>
            <PrimaryButton
              label="Share Call Link"
              icon={<Share2 size={17} color="#FFFFFF" strokeWidth={2} />}
              onPress={() => onSharePublished(publishedReceipt.callId)}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <SecondaryButton
                label="Show QR"
                icon={<QrCode size={16} color={colors.ink} strokeWidth={2} />}
                onPress={() => onShowQrPublished(publishedReceipt.callId)}
                style={{ flex: 1 }}
              />
              <SecondaryButton
                label="Open Thread"
                onPress={() => onViewPublishedThread(publishedReceipt.callId)}
                style={{ flex: 1 }}
              />
            </View>
            <Pressable
              onPress={onClearReceipt}
              style={{ alignItems: 'center', paddingVertical: SPACING.sm }}
            >
              <Text style={[TYPE.captionSemi, { color: colors.ink3 }]}>
                Create another call
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  const stepMeta =
    step === 1
      ? {
          title: 'Select token & stake',
          subtitle: 'Lock your own SOL first — caller and followers enter in the same swap.',
        }
      : step === 2
        ? {
            title: 'Set immutable exit rules',
            subtitle: 'TP, SL, and hold window lock permanently when your call opens.',
          }
        : {
            title: 'Review & lock SOL',
            subtitle: 'Verify every rule before signing in your wallet.',
          };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.scrollContent}
      >
        <View
          style={[
            s.card,
            SHADOWS.card,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <SegmentedProgress
            currentStep={step}
            totalSteps={3}
            title={stepMeta.title}
            subtitle={stepMeta.subtitle}
          />
        </View>

        {step === 1 && (
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Token Pool</Text>
            <View style={s.tokenGrid}>
              {tokens.map((tok, idx) => {
                const selected = idx === tokenIdx;
                const resSol = Number(BigInt(tok.solReserveLamports)) / 1e9;
                const resTok =
                  Number(BigInt(tok.tokenReserveAtoms)) / 10 ** tok.decimals;
                const unitPriceSol = resTok > 0 ? resSol / resTok : 0;

                return (
                  <Pressable
                    key={tok.mint}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onChangeTokenIdx(idx);
                    }}
                    style={[
                      s.tokenCard,
                      {
                        backgroundColor: selected ? colors.openFill : colors.subtle,
                        borderColor: selected ? colors.open : colors.line,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        TYPE.bodySemi,
                        { color: selected ? colors.openText : colors.ink },
                      ]}
                    >
                      ${tok.symbol}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[TYPE.micro, { color: colors.ink3, fontWeight: '500' }]}
                    >
                      {resSol.toFixed(2)} SOL liq
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontSize: 10 }]}
                    >
                      {unitPriceSol > 0 ? `${unitPriceSol.toExponential(1)} SOL` : tok.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Phantom / Jupiter Swap-Style Stake Input */}
            <View
              style={[
                s.swapBox,
                {
                  backgroundColor: colors.subtle,
                  borderColor:
                    stakeExceedsImpact || stakeExceedsTierCap
                      ? colors.loss
                      : colors.lineStrong,
                },
              ]}
            >
              <View style={s.rowBetween}>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Your Locked Stake</Text>
                <View style={s.balanceRow}>
                  <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3 }]}>
                    {balanceSol !== null
                      ? `Balance: ${balanceSol.toFixed(3)} SOL`
                      : 'Wallet not connected'}
                  </Text>
                  <Pressable
                    onPress={handlePressMax}
                    style={[s.maxBtn, { backgroundColor: colors.openFill }]}
                  >
                    <Text style={[TYPE.micro, { color: colors.openText, fontSize: 11 }]}>
                      MAX
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={s.amountInputRow}>
                <TextInput
                  value={stakeSol}
                  onChangeText={onChangeStakeSol}
                  keyboardType="decimal-pad"
                  placeholder="0.01"
                  placeholderTextColor={colors.ink3}
                  style={[
                    TYPE.display,
                    TYPE.num,
                    s.largeInput,
                    { color: colors.ink },
                  ]}
                />
                <View
                  style={[
                    s.solSuffixPill,
                    { backgroundColor: colors.surface, borderColor: colors.line },
                  ]}
                >
                  <Text style={[TYPE.bodySemi, { color: colors.ink }]}>SOL</Text>
                </View>
              </View>

              {/* Quick Presets */}
              <View style={s.presetsRow}>
                {STAKE_PRESETS.map((preset) => {
                  const active = stakeSol === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onChangeStakeSol(preset);
                      }}
                      style={[
                        s.presetChip,
                        {
                          backgroundColor: active ? colors.ink : colors.surface,
                          borderColor: active ? colors.ink : colors.line,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          TYPE.micro,
                          TYPE.num,
                          { color: active ? colors.onPrimary : colors.ink2 },
                        ]}
                      >
                        {preset}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Colored Buy Impact Indicator + Expandable Detail */}
            <Pressable
              onPress={() => setImpactExpanded((v) => !v)}
              style={[
                s.impactBar,
                { backgroundColor: impactTone.bg },
              ]}
            >
              <View style={s.rowBetween}>
                <Text style={[TYPE.captionSemi, TYPE.num, { color: impactTone.fg }]}>
                  Buy impact: {impactPct.toFixed(2)}% · {impactTone.label}
                </Text>
                {impactExpanded ? (
                  <ChevronUp size={16} color={impactTone.fg} strokeWidth={2} />
                ) : (
                  <ChevronDown size={16} color={impactTone.fg} strokeWidth={2} />
                )}
              </View>

              {impactExpanded && (
                <View style={{ marginTop: 6, gap: 3 }}>
                  <Text style={[TYPE.micro, TYPE.num, { color: impactTone.fg, fontWeight: '500' }]}>
                    • Protocol safety cap: 2.00% max price impact ({max2PctSol.toFixed(4)} SOL on $
                    {selectedToken?.symbol})
                  </Text>
                  <Text style={[TYPE.micro, TYPE.num, { color: impactTone.fg, fontWeight: '500' }]}>
                    • Estimated pool output:{' '}
                    {(
                      Number(estTokensOut) /
                      10 ** (selectedToken?.decimals ?? 6)
                    ).toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                    ${selectedToken?.symbol}
                  </Text>
                  <Text style={[TYPE.micro, { color: impactTone.fg, fontWeight: '500' }]}>
                    • Skin-in-the-game rule: your stake must stay ≥5% of total pool size (up to{' '}
                    {(parsedStake * 20).toFixed(3)} SOL total pool).
                  </Text>
                </View>
              )}
            </Pressable>

            {stakeExceedsImpact && (
              <SecondaryButton
                label={`Adjust to 2% impact limit (${max2PctSol.toFixed(4)} SOL)`}
                compact
                onPress={handlePressMax}
              />
            )}

            {stakeExceedsTierCap && (
              <Text style={[TYPE.caption, { color: colors.loss }]}>
                Stake exceeds your Tier {tier} cap ({bondCapSol.toFixed(3)} SOL). Lower stake or
                verify Seeker hardware in Profile.
              </Text>
            )}
          </View>
        )}

        {step === 2 && (
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            {/* Live Caller Tier Cap Notice */}
            <View
              style={[
                s.tierNotice,
                { backgroundColor: colors.openFill, borderColor: colors.open },
              ]}
            >
              <ShieldCheck size={16} color={colors.openText} strokeWidth={2} />
              <Text style={[TYPE.caption, { color: colors.openText, flex: 1 }]}>
                Caller Tier {tier} ({isSeekerVerified ? 'Seeker Verified' : 'Unverified'}):{' '}
                {bondMultiple}× bond cap ({bondCapSol.toFixed(2)} SOL) · {maxSharePct}% max profit
                fee
              </Text>
            </View>

            {/* Take-Profit Presets */}
            <View style={{ gap: SPACING.xs + 2 }}>
              <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Take-Profit (TP)</Text>
              <View style={s.presetsRow}>
                {[20, 25, 50].map((tp) => {
                  const active = tpPct === tp;
                  return (
                    <Pressable
                      key={tp}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onChangeTpPct(tp);
                      }}
                      style={[
                        s.ruleOption,
                        {
                          backgroundColor: active ? colors.gainFill : colors.subtle,
                          borderColor: active ? colors.gain : colors.line,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          TYPE.captionSemi,
                          TYPE.num,
                          { color: active ? colors.gainText : colors.ink2 },
                        ]}
                      >
                        +{tp}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Stop-Loss Presets */}
            <View style={{ gap: SPACING.xs + 2 }}>
              <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Stop-Loss (SL)</Text>
              <View style={s.presetsRow}>
                {[10, 15, 20].map((sl) => {
                  const active = slPct === sl;
                  return (
                    <Pressable
                      key={sl}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onChangeSlPct(sl);
                      }}
                      style={[
                        s.ruleOption,
                        {
                          backgroundColor: active ? colors.lossFill : colors.subtle,
                          borderColor: active ? colors.loss : colors.line,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          TYPE.captionSemi,
                          TYPE.num,
                          { color: active ? colors.lossText : colors.ink2 },
                        ]}
                      >
                        −{sl}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Max Hold Window Presets */}
            <View style={{ gap: SPACING.xs + 2 }}>
              <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Max Hold Window</Text>
              <View style={s.presetsRow}>
                {[5, 15, 30].map((m) => {
                  const active = maxHoldMin === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onChangeMaxHoldMin(m);
                      }}
                      style={[
                        s.ruleOption,
                        {
                          backgroundColor: active ? colors.openFill : colors.subtle,
                          borderColor: active ? colors.open : colors.line,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          TYPE.captionSemi,
                          TYPE.num,
                          { color: active ? colors.openText : colors.ink2 },
                        ]}
                      >
                        {m}m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Join Window Presets */}
            <View style={{ gap: SPACING.xs + 2 }}>
              <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Follower Join Window</Text>
              <View style={s.presetsRow}>
                {[2, 5, 10].map((w) => {
                  const active = windowMin === w;
                  return (
                    <Pressable
                      key={w}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onChangeWindowMin(w);
                      }}
                      style={[
                        s.ruleOption,
                        {
                          backgroundColor: active ? colors.openFill : colors.subtle,
                          borderColor: active ? colors.open : colors.line,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          TYPE.captionSemi,
                          TYPE.num,
                          { color: active ? colors.openText : colors.ink2 },
                        ]}
                      >
                        {w}m open
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Custom TP / SL / Fee Toggle */}
            <Pressable
              onPress={() => setCustomRulesOpen((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Info size={14} color={colors.accent} strokeWidth={2} />
              <Text style={[TYPE.captionSemi, { color: colors.accent }]}>
                {customRulesOpen ? 'Hide custom rule inputs' : 'Customize exact TP / SL / Fee %'}
              </Text>
            </Pressable>

            {customRulesOpen && (
              <View style={s.customInputsRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>TP %</Text>
                  <TextInput
                    value={String(tpPct)}
                    onChangeText={(t) => onChangeTpPct(Math.max(0, Number(t.replace(/\D/g, '')) || 0))}
                    keyboardType="number-pad"
                    style={[
                      s.smallInput,
                      TYPE.num,
                      { backgroundColor: colors.subtle, borderColor: colors.line, color: colors.ink },
                    ]}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>SL %</Text>
                  <TextInput
                    value={String(slPct)}
                    onChangeText={(t) => onChangeSlPct(Math.min(90, Math.max(1, Number(t.replace(/\D/g, '')) || 1)))}
                    keyboardType="number-pad"
                    style={[
                      s.smallInput,
                      TYPE.num,
                      { backgroundColor: colors.subtle, borderColor: colors.line, color: colors.ink },
                    ]}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>
                    Fee % (≤{maxSharePct})
                  </Text>
                  <TextInput
                    value={String(sharePct)}
                    onChangeText={(t) =>
                      onChangeSharePct(
                        Math.min(maxSharePct, Math.max(0, Number(t.replace(/\D/g, '')) || 0)),
                      )
                    }
                    keyboardType="number-pad"
                    style={[
                      s.smallInput,
                      TYPE.num,
                      { backgroundColor: colors.subtle, borderColor: colors.line, color: colors.ink },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Thesis Input + Counter */}
            <View style={{ gap: 6 }}>
              <View style={s.rowBetween}>
                <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>Call Thesis</Text>
                <Text
                  style={[
                    TYPE.micro,
                    TYPE.num,
                    { color: thesis.length > 260 ? colors.holdingText : colors.ink3 },
                  ]}
                >
                  {thesis.length} / 280
                </Text>
              </View>
              <TextInput
                value={thesis}
                onChangeText={onChangeThesis}
                multiline
                maxLength={280}
                placeholder="State your thesis, catalyst, and invalidation clearly…"
                placeholderTextColor={colors.ink3}
                style={[
                  TYPE.body,
                  s.thesisInput,
                  {
                    backgroundColor: colors.subtle,
                    borderColor: colors.lineStrong,
                    color: colors.ink,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {step === 3 && (
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            {/* Prominent Immutable Warning Banner */}
            <View
              style={[
                s.lockWarning,
                { backgroundColor: colors.holdingFill, borderColor: colors.holding },
              ]}
            >
              <AlertTriangle size={20} color={colors.holdingText} strokeWidth={2.1} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[TYPE.captionSemi, { color: colors.holdingText }]}>
                  Immutable On-Chain Commitment
                </Text>
                <Text style={[TYPE.caption, { color: colors.holdingText }]}>
                  Your SOL is locked until this call settles. Rules cannot be changed after
                  posting.
                </Text>
              </View>
            </View>

            {/* Summary Card */}
            <View
              style={[
                s.summaryBox,
                { backgroundColor: colors.subtle, borderColor: colors.line },
              ]}
            >
              <View style={s.rowBetween}>
                <Text style={[TYPE.title, { color: colors.ink }]}>
                  ${selectedToken?.symbol} Pool
                </Text>
                <Text style={[TYPE.title, TYPE.num, { color: colors.accent }]}>
                  {parsedStake} SOL Stake
                </Text>
              </View>

              <Text style={[TYPE.body, { color: colors.ink2 }]}>{thesis}</Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <RuleChip kind="tp" label={`TP +${tpPct}%`} />
                <RuleChip kind="sl" label={`SL −${slPct}%`} />
                <RuleChip kind="time" label={`Max ${maxHoldMin}m`} />
              </View>

              <View style={[s.divider, { backgroundColor: colors.line }]} />

              <View style={s.rowBetween}>
                <Text style={[TYPE.caption, { color: colors.ink3 }]}>Join window</Text>
                <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                  {windowMin} minutes
                </Text>
              </View>
              <View style={s.rowBetween}>
                <Text style={[TYPE.caption, { color: colors.ink3 }]}>Caller profit fee (wins only)</Text>
                <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                  {sharePct}%
                </Text>
              </View>
              <View style={s.rowBetween}>
                <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                  Reusable caller bond
                </Text>
                <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                  {needsBondSol > 0
                    ? `+${needsBondSol.toFixed(3)} SOL (first-time deposit)`
                    : `0 SOL (${formatSolFloor(myCallerRecord?.bondLamports ?? '0', 2)} SOL already active)`}
                </Text>
              </View>
              <View style={s.rowBetween}>
                <Text style={[TYPE.captionSemi, { color: colors.ink }]}>Total wallet debit now</Text>
                <Text style={[TYPE.bodySemi, TYPE.num, { color: colors.ink }]}>
                  {(parsedStake + needsBondSol).toFixed(4)} SOL
                </Text>
              </View>
            </View>

            {submitError && (
              <View
                style={[
                  s.errorBox,
                  { backgroundColor: colors.lossFill, borderColor: colors.loss },
                ]}
              >
                <Text style={[TYPE.captionSemi, { color: colors.lossText }]}>
                  Transaction not completed
                </Text>
                <Text style={[TYPE.caption, { color: colors.lossText }]}>{submitError}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom CTA Bar */}
      <View style={[s.stickyFooter, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        {step === 1 && (
          <PrimaryButton
            label="Continue to Exit Rules"
            disabled={!step1Valid}
            onPress={() => onChangeStep(2)}
            style={{ flex: 1 }}
          />
        )}

        {step === 2 && (
          <>
            <SecondaryButton label="Back" onPress={() => onChangeStep(1)} />
            <PrimaryButton
              label="Review Call"
              disabled={!step2Valid}
              onPress={() => onChangeStep(3)}
              style={{ flex: 1 }}
            />
          </>
        )}

        {step === 3 && (
          <>
            <SecondaryButton label="Edit" disabled={busy} onPress={() => onChangeStep(2)} />
            {connected ? (
              <PrimaryButton
                label={busy ? 'Confirming in wallet…' : `Lock ${parsedStake} SOL & Post`}
                loading={busy}
                icon={<Lock size={16} color="#FFFFFF" strokeWidth={2.1} />}
                onPress={onPublish}
                style={{ flex: 1 }}
              />
            ) : (
              <PrimaryButton
                label="Connect Wallet to Post"
                icon={<Wallet size={16} color="#FFFFFF" strokeWidth={2.1} />}
                onPress={onConnect}
                style={{ flex: 1 }}
              />
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  tokenGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  tokenCard: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1.5,
    gap: 2,
  },
  swapBox: {
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    gap: SPACING.sm + 2,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  maxBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.xs,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  largeInput: {
    flex: 1,
    fontSize: 28,
    lineHeight: 34,
    paddingVertical: 4,
  },
  solSuffixPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  presetChip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: RADII.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  impactBar: {
    padding: SPACING.md,
    borderRadius: RADII.md,
  },
  tierNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  ruleOption: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 2,
    borderRadius: RADII.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customInputsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  smallInput: {
    minHeight: 40,
    borderRadius: RADII.sm,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  thesisInput: {
    minHeight: 92,
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    textAlignVertical: 'top',
  },
  lockWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm + 2,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  summaryBox: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: SPACING.sm + 2,
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
  errorBox: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 2,
  },
  stickyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderTopWidth: 1,
  },
  successCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulesRowCenter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
});
