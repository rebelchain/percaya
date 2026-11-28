import {
  displayIdentity,
  evaluateSellRule,
  formatSolFloor,
  type CallDetail,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDurationCompact, formatTimeAgo } from '../theme/format';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { ResultCardSheet } from './ResultCardSheet';
import { BottomSheet } from './ui/BottomSheet';
import {
  ArrowLeft,
  Award,
  Bell,
  BellRing,
  Info,
  Lock,
  MessageCircle,
  QrCode,
  Send,
  Share2,
  Zap,
} from './ui/icons';
import {
  Avatar,
  PnLText,
  PoolBar,
  PrimaryButton,
  RuleChip,
  SecondaryButton,
  StatusPill,
  TierBadge,
} from './ui/primitives';

export interface CallDetailModalProps {
  call: CallDetail | null;
  nowSec: number;
  viewerPubkey?: string | null;
  isWatching: boolean;
  depositSol: string;
  onChangeDepositSol: (val: string) => void;
  replyDraft: string;
  onChangeReplyDraft: (val: string) => void;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onShowQr: (callId: number) => void;
  onShare: (call: CallDetail) => void;
  onToggleWatch: (callId: number) => void;
  onOpenCaller: (pubkey: string) => void;
  onPostReply: (call: CallDetail) => void;
  onDeposit: (call: CallDetail) => void;
  onPoolAction: (action: 'buy' | 'checkpoint' | 'sell' | 'claim', call: CallDetail) => void;
}

const DEPOSIT_PRESETS = ['0.005', '0.01', '0.02'];

export function CallDetailModal({
  call,
  nowSec,
  viewerPubkey,
  isWatching,
  depositSol,
  onChangeDepositSol,
  replyDraft,
  onChangeReplyDraft,
  busy,
  refreshing,
  onRefresh,
  onClose,
  onShowQr,
  onShare,
  onToggleWatch,
  onOpenCaller,
  onPostReply,
  onDeposit,
  onPoolAction,
}: CallDetailModalProps) {
  const { colors } = useTheme();
  const [techSheetOpen, setTechSheetOpen] = useState(false);
  const [resultCardOpen, setResultCardOpen] = useState(false);

  if (!call) return null;

  const tpLabel =
    call.rules.takeProfitBps > 0
      ? `TP +${(call.rules.takeProfitBps / 100).toFixed(0)}%`
      : 'TP Open';
  const slLabel = `SL −${(call.rules.stopLossBps / 100).toFixed(0)}%`;
  const maxTimeLabel = `Max ${formatDurationCompact(call.rules.maxHoldSec)}`;

  const windowOpen = call.state === 'Open' && nowSec < call.rules.windowEnd;
  const isCaller = Boolean(viewerPubkey && viewerPubkey === call.caller);
  const canCallerBuy =
    call.state === 'Open' &&
    nowSec >= call.rules.windowEnd &&
    nowSec <= call.rules.buyDeadline &&
    isCaller &&
    BigInt(call.totalInLamports) >= BigInt(call.rules.minPoolLamports);

  const myPos = viewerPubkey
    ? call.positions.find((p) => p.participant === viewerPubkey)
    : undefined;
  const myClaimableLamports = BigInt(myPos && !myPos.claimed ? myPos.claimableAmount || '0' : '0');

  const cpCount =
    call.prevCheckpoint.at > 0 && call.lastCheckpoint.at > 0
      ? 2
      : call.lastCheckpoint.at > 0
        ? 1
        : 0;
  const nextCpWaitSec =
    call.state === 'Holding' && cpCount === 1
      ? Math.max(0, call.lastCheckpoint.at + call.rules.checkpointGapSec - nowSec)
      : 0;

  const sellEval =
    call.state === 'Holding'
      ? evaluateSellRule({
          nowSec,
          totalInLamports: BigInt(call.totalInLamports),
          prevValue: BigInt(call.prevCheckpoint.valueLamports),
          prevAt: call.prevCheckpoint.at,
          lastValue: BigInt(call.lastCheckpoint.valueLamports),
          lastAt: call.lastCheckpoint.at,
          holdUntil: call.holdUntil,
          checkpointGapSec: call.rules.checkpointGapSec,
          takeProfitBps: call.rules.takeProfitBps,
          stopLossBps: call.rules.stopLossBps,
          sellToleranceBps: call.rules.sellToleranceBps,
        })
      : { canSell: false, reason: 'None' as const, minOutLamports: 0n };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {/* Top Bar */}
          <View style={[s.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
            <Pressable
              onPress={onClose}
              style={s.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to feed"
            >
              <ArrowLeft size={20} color={colors.ink} strokeWidth={2} />
              <Text style={[TYPE.bodySemi, { color: colors.ink }]}>Call #{call.callId}</Text>
            </Pressable>

            <View style={s.topRightActions}>
              <Pressable
                onPress={() => onToggleWatch(call.callId)}
                style={[s.headerIconBtn, { backgroundColor: colors.subtle }]}
                accessibilityLabel={isWatching ? 'Alerts enabled' : 'Enable alerts'}
              >
                {isWatching ? (
                  <BellRing size={17} color={colors.accent} strokeWidth={2} />
                ) : (
                  <Bell size={17} color={colors.ink2} strokeWidth={1.9} />
                )}
              </Pressable>

              <Pressable
                onPress={() => onShowQr(call.callId)}
                style={[s.headerIconBtn, { backgroundColor: colors.subtle }]}
                accessibilityLabel="Show Call QR code"
              >
                <QrCode size={17} color={colors.ink2} strokeWidth={1.9} />
              </Pressable>

              <Pressable
                onPress={() => onShare(call)}
                style={[s.headerIconBtn, { backgroundColor: colors.openFill }]}
                accessibilityLabel="Share call"
              >
                <Share2 size={17} color={colors.openText} strokeWidth={1.9} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
          >
            {/* Root Call Card */}
            <View
              style={[
                s.card,
                SHADOWS.card,
                { backgroundColor: colors.surface, borderColor: colors.line },
              ]}
            >
              <View style={s.rowBetween}>
                <Pressable
                  onPress={() => {
                    onClose();
                    onOpenCaller(call.caller);
                  }}
                  style={s.callerRow}
                >
                  <Avatar seed={call.caller} size={42} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={[TYPE.bodySemi, { color: colors.ink }]}>
                        {displayIdentity(call.caller, call.callerSkr)}
                      </Text>
                      <TierBadge
                        verified={call.callerSeekerVerified}
                        tier={call.callerTier}
                      />
                    </View>
                    <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontWeight: '500' }]}>
                      Opened {formatTimeAgo(call.openedAt, nowSec)} ago
                    </Text>
                  </View>
                </Pressable>

                <StatusPill
                  state={call.state}
                  netReturnBps={call.netReturnBps}
                  windowEnd={call.rules.windowEnd}
                  nowSec={nowSec}
                />
              </View>

              <Text style={[TYPE.body, { color: colors.ink }]}>{call.thesis}</Text>

              {/* Pool & Rules Panel */}
              <View
                style={[
                  s.poolBox,
                  { backgroundColor: colors.subtle, borderColor: colors.line },
                ]}
              >
                <View style={s.rowBetween}>
                  <Text style={[TYPE.title, { color: colors.ink }]}>${call.token.symbol}</Text>
                  {call.state === 'Settled' ? (
                    <PnLText bps={call.netReturnBps} size="lg" />
                  ) : call.state === 'Holding' && call.liveQuoteNetBps !== null ? (
                    <PnLText bps={call.liveQuoteNetBps} size="md" suffix="live" />
                  ) : null}
                </View>

                <View style={s.rulesWrap}>
                  <RuleChip kind="tp" label={tpLabel} />
                  <RuleChip kind="sl" label={slLabel} />
                  <RuleChip kind="time" label={maxTimeLabel} />
                  <View style={s.lockInline}>
                    <Lock size={12} color={colors.ink3} strokeWidth={2} />
                    <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '500' }]}>
                      Fixed at open
                    </Text>
                  </View>
                </View>

                <PoolBar
                  totalInLamports={call.totalInLamports}
                  callerStakeLamports={call.callerStakeLamports}
                  liveCapLamports={call.liveCapLamports}
                  depositorsCount={call.depositorsCount}
                />

                {call.state === 'Holding' && (
                  <View style={[s.holdingBanner, { backgroundColor: colors.holdingFill }]}>
                    <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.holdingText }]}>
                      Checkpoints: {cpCount}/2
                      {nextCpWaitSec > 0
                        ? ` · Next check unlocks in ${nextCpWaitSec}s`
                        : sellEval.canSell
                          ? ` · Exit verified (${sellEval.reason})`
                          : ' · Ready to record checkpoint'}
                    </Text>
                  </View>
                )}

                <View style={s.rowBetween}>
                  <Pressable
                    onPress={() => setTechSheetOpen(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}
                  >
                    <Info size={13} color={colors.accent} strokeWidth={2} />
                    <Text style={[TYPE.micro, { color: colors.accent }]}>
                      Pool & fee details
                    </Text>
                  </Pressable>

                  {call.state === 'Settled' && (
                    <Pressable
                      onPress={() => setResultCardOpen(true)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}
                    >
                      <Award size={14} color={colors.accent} strokeWidth={2} />
                      <Text style={[TYPE.micro, { color: colors.accent }]}>
                        Result card
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            {/* Thread Replies Section */}
            <View style={{ gap: SPACING.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
                <MessageCircle size={15} color={colors.ink2} strokeWidth={2} />
                <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
                  Thread Replies ({call.replies.length})
                </Text>
                <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                  · Auto-tagged In Pool vs Spectator
                </Text>
              </View>

              {call.replies.length === 0 ? (
                <View
                  style={[
                    s.card,
                    { backgroundColor: colors.surface, borderColor: colors.line },
                  ]}
                >
                  <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                    No replies yet. Join the pool or post the first note below.
                  </Text>
                </View>
              ) : (
                call.replies.map((rep) => {
                  const inPool = BigInt(rep.depositedLamports) > 0n;
                  return (
                    <View
                      key={rep.id}
                      style={[
                        s.replyCard,
                        { backgroundColor: colors.surface, borderColor: colors.line },
                      ]}
                    >
                      <View style={s.rowBetween}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <Avatar seed={rep.author} size={28} />
                          <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
                            {displayIdentity(rep.author, rep.authorSkr)}
                          </Text>
                          <View
                            style={[
                              s.skinTag,
                              {
                                backgroundColor: inPool ? colors.openFill : colors.subtle,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                TYPE.micro,
                                TYPE.num,
                                {
                                  fontSize: 10,
                                  color: inPool ? colors.openText : colors.ink3,
                                },
                              ]}
                            >
                              {rep.isCaller
                                ? `Caller · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                                : inPool
                                  ? `In Pool · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                                  : 'Spectator'}
                            </Text>
                          </View>
                        </View>
                        <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3 }]}>
                          {formatTimeAgo(rep.createdAt, nowSec)}
                        </Text>
                      </View>
                      <Text style={[TYPE.body, { color: colors.ink, fontSize: 14 }]}>
                        {rep.body}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>

          {/* Bottom Reply & Pool Action Dock */}
          <View style={[s.dock, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
            {/* Reply Input Row */}
            <View style={s.replyInputRow}>
              <TextInput
                value={replyDraft}
                onChangeText={onChangeReplyDraft}
                placeholder="Write a reply…"
                placeholderTextColor={colors.ink3}
                style={[
                  TYPE.caption,
                  s.replyInput,
                  { backgroundColor: colors.subtle, borderColor: colors.line, color: colors.ink },
                ]}
              />
              <Pressable
                onPress={() => onPostReply(call)}
                style={[s.sendBtn, { backgroundColor: colors.subtle, borderColor: colors.lineStrong }]}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
              >
                <Send size={16} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </View>

            {/* Primary Pool Lifecycle Action */}
            {windowOpen ? (
              <View style={s.depositRow}>
                <View style={s.presetGroup}>
                  {DEPOSIT_PRESETS.map((p) => {
                    const active = depositSol === p;
                    return (
                      <Pressable
                        key={p}
                        onPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          onChangeDepositSol(p);
                        }}
                        style={[
                          s.depChip,
                          {
                            backgroundColor: active ? colors.openFill : colors.subtle,
                            borderColor: active ? colors.open : colors.line,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            TYPE.micro,
                            TYPE.num,
                            { color: active ? colors.openText : colors.ink2 },
                          ]}
                        >
                          {p}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  value={depositSol}
                  onChangeText={onChangeDepositSol}
                  keyboardType="decimal-pad"
                  style={[
                    TYPE.bodySemi,
                    TYPE.num,
                    s.depInput,
                    { backgroundColor: colors.subtle, borderColor: colors.lineStrong, color: colors.ink },
                  ]}
                />

                <PrimaryButton
                  label="Join pool"
                  loading={busy}
                  onPress={() => onDeposit(call)}
                  style={{ flex: 1 }}
                />
              </View>
            ) : canCallerBuy ? (
              <PrimaryButton
                label="Execute Pool Buy (Open → Holding)"
                loading={busy}
                icon={<Zap size={16} color="#FFFFFF" strokeWidth={2.2} />}
                onPress={() => onPoolAction('buy', call)}
              />
            ) : call.state === 'Open' ? (
              <View style={[s.closedNotice, { backgroundColor: colors.subtle }]}>
                <Text style={[TYPE.caption, { color: colors.ink3, textAlign: 'center' }]}>
                  Join window closed · Waiting for caller to execute pool buy
                </Text>
              </View>
            ) : call.state === 'Holding' ? (
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                <SecondaryButton
                  label={nextCpWaitSec > 0 ? `Wait ${nextCpWaitSec}s` : 'Checkpoint'}
                  disabled={busy || nextCpWaitSec > 0}
                  onPress={() => onPoolAction('checkpoint', call)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Sell & Earn 0.1%"
                  loading={busy}
                  disabled={!sellEval.canSell}
                  onPress={() => onPoolAction('sell', call)}
                  style={{ flex: 1.3 }}
                />
              </View>
            ) : myClaimableLamports > 0n ? (
              <PrimaryButton
                label={`Claim ${formatSolFloor(myClaimableLamports, 4)} SOL`}
                loading={busy}
                onPress={() => onPoolAction('claim', call)}
              />
            ) : call.state === 'Settled' ? (
              <SecondaryButton
                label="Share On-Chain Result Card"
                icon={<Award size={16} color={colors.ink} strokeWidth={2} />}
                onPress={() => setResultCardOpen(true)}
              />
            ) : null}
          </View>

          {/* Technical Pool & Fee Details Sheet */}
          <BottomSheet
            visible={techSheetOpen}
            onClose={() => setTechSheetOpen(false)}
            title="Technical Pool Details"
            subtitle={`Call #${call.callId} on Solana Devnet`}
          >
            <View
              style={[
                s.techList,
                { backgroundColor: colors.subtle, borderColor: colors.line },
              ]}
            >
              <Text style={[TYPE.micro, { color: colors.ink3 }]}>Caller Profit Share (wins only)</Text>
              <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                {(call.rules.shareBps / 100).toFixed(1)}% · Keeper reward{' '}
                {(call.rules.keeperBps / 100).toFixed(2)}%
              </Text>

              <Text style={[TYPE.micro, { color: colors.ink3, marginTop: 6 }]}>CallPool PDA</Text>
              <Text selectable style={[TYPE.micro, TYPE.num, { color: colors.ink2 }]}>
                {call.pda}
              </Text>

              <Text style={[TYPE.micro, { color: colors.ink3, marginTop: 6 }]}>Token Mint</Text>
              <Text selectable style={[TYPE.micro, TYPE.num, { color: colors.ink2 }]}>
                {call.token.mint}
              </Text>

              <Text style={[TYPE.micro, { color: colors.ink3, marginTop: 6 }]}>AMM Pool</Text>
              <Text selectable style={[TYPE.micro, TYPE.num, { color: colors.ink2 }]}>
                {call.rules.ammPool}
              </Text>
            </View>
            <SecondaryButton label="Close" onPress={() => setTechSheetOpen(false)} />
          </BottomSheet>

          <ResultCardSheet
            call={call}
            visible={resultCardOpen}
            onClose={() => setResultCardOpen(false)}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  topBar: {
    minHeight: 54,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: SPACING.sm,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  callerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  poolBox: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm + 2,
  },
  rulesWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  lockInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  holdingBanner: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 6,
    borderRadius: RADII.sm,
  },
  replyCard: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 6,
  },
  skinTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADII.xs,
  },
  dock: {
    borderTopWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    gap: SPACING.sm,
  },
  replyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  replyInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: RADII.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presetGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  depChip: {
    minHeight: MIN_TOUCH_TARGET - 4,
    paddingHorizontal: 8,
    borderRadius: RADII.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depInput: {
    width: 72,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    borderWidth: 1,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  closedNotice: {
    padding: SPACING.sm + 2,
    borderRadius: RADII.md,
  },
  techList: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 3,
  },
});
