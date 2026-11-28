import {
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  type CallDetail,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { explainTierBadge } from '../onboarding';
import { containsProfanity } from '../profanity';
import { formatDurationCompact, formatTimeAgo } from '../theme/format';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from './ui/BottomSheet';
import {
  Bell,
  BellRing,
  Eye,
  Lock,
  MessageCircle,
  Share2,
  ShieldCheck,
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

export interface CallCardProps {
  call: CallDetail;
  nowSec: number;
  isWatching: boolean;
  viewerPubkey?: string | null;
  busy?: boolean;
  onPressCard: (call: CallDetail) => void;
  onPressCaller: (callerPubkey: string) => void;
  onPressJoin: (call: CallDetail) => void;
  onPressBuy?: (call: CallDetail) => void;
  onToggleWatch: (callId: number) => void;
  onShare: (call: CallDetail) => void;
}

function refundExplanation(reason: CallDetail['settleReason']): string {
  if (reason === 'MinPoolRefund') {
    return 'Minimum pool threshold was not met — all SOL refunded 1:1.';
  }
  if (reason === 'DeadlineRefund') {
    return 'Join window closed without pool buy — all deposits refunded 1:1.';
  }
  return 'Pool refunded 1:1 to depositors.';
}

/**
 * Redesigned CallCard (Phase 2):
 * Caller Identity -> Thesis -> Locked Rules + PoolBar -> Result / Actions.
 * Designed for 3-second mobile trader scan speed.
 */
export function CallCard({
  call,
  nowSec,
  isWatching,
  viewerPubkey,
  busy,
  onPressCard,
  onPressCaller,
  onPressJoin,
  onPressBuy,
  onToggleWatch,
  onShare,
}: CallCardProps) {
  const { colors } = useTheme();
  const [expandedThesis, setExpandedThesis] = useState(false);
  const [profanityRevealed, setProfanityRevealed] = useState(false);
  const [tierSheetOpen, setTierSheetOpen] = useState(false);
  const [rulesSheetOpen, setRulesSheetOpen] = useState(false);

  const flagged = containsProfanity(call.thesis);
  const hideThesis = flagged && !profanityRevealed;
  const shouldTruncate = call.thesis.length > 165 && !expandedThesis;

  const tpLabel =
    call.rules.takeProfitBps > 0
      ? `TP +${(call.rules.takeProfitBps / 100).toFixed(0)}%`
      : 'TP Open';
  const slLabel = `SL −${(call.rules.stopLossBps / 100).toFixed(0)}%`;
  const maxTimeLabel = `Max ${formatDurationCompact(call.rules.maxHoldSec)}`;

  const callerWins = Math.max(0, call.callerSettled - call.callerLosses);
  const windowOpen = call.state === 'Open' && nowSec < call.rules.windowEnd;
  const readyForCallerBuy =
    call.state === 'Open' &&
    nowSec >= call.rules.windowEnd &&
    nowSec <= call.rules.buyDeadline &&
    viewerPubkey === call.caller &&
    BigInt(call.totalInLamports) >= BigInt(call.rules.minPoolLamports);

  const latestReply = call.replies[call.replies.length - 1];
  const tierExplainer = explainTierBadge(call.callerSeekerVerified, call.callerTier);

  return (
    <>
      <Pressable
        onPress={() => onPressCard(call)}
        style={({ pressed }) => [
          s.card,
          SHADOWS.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.line,
            opacity: pressed ? 0.96 : 1,
          },
        ]}
      >
        {/* 1. Header Row: Identicon + Handle + TierBadge + Mini Track Record + StatusPill */}
        <View style={s.headerRow}>
          <Pressable
            onPress={() => onPressCaller(call.caller)}
            style={s.callerTap}
            accessibilityRole="button"
            accessibilityLabel={`View caller ${displayIdentity(call.caller, call.callerSkr)}`}
          >
            <Avatar seed={call.caller} size={40} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={s.identityLine}>
                <Text
                  numberOfLines={1}
                  style={[TYPE.bodySemi, { color: colors.ink, flexShrink: 1 }]}
                >
                  {displayIdentity(call.caller, call.callerSkr)}
                </Text>
                <TierBadge
                  verified={call.callerSeekerVerified}
                  tier={call.callerTier}
                  onPress={() => setTierSheetOpen(true)}
                />
              </View>
              <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontWeight: '500' }]}>
                {call.callerSettled > 0
                  ? `${call.callerSettled} calls · ${callerWins} won · `
                  : ''}
                {formatTimeAgo(call.openedAt, nowSec)} ago
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

        {/* 2. Thesis Text (max 4 lines + "more" + light profanity filter) */}
        {hideThesis ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setProfanityRevealed(true);
            }}
            style={[
              s.profanityBox,
              { backgroundColor: colors.subtle, borderColor: colors.line },
            ]}
          >
            <Eye size={15} color={colors.ink3} strokeWidth={2} />
            <Text style={[TYPE.caption, { color: colors.ink2, flex: 1 }]}>
              Strong language filtered · Tap to view unedited caller thesis
            </Text>
          </Pressable>
        ) : (
          <View>
            <Text
              numberOfLines={expandedThesis ? undefined : 4}
              style={[TYPE.body, { color: colors.ink }]}
            >
              {call.thesis}
            </Text>
            {shouldTruncate && (
              <Pressable
                onPress={() => setExpandedThesis(true)}
                hitSlop={6}
                style={{ alignSelf: 'flex-start', marginTop: 2 }}
              >
                <Text style={[TYPE.captionSemi, { color: colors.accent }]}>more</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* 3. Rules & Pool Block (Signature Visual) */}
        <View
          style={[
            s.poolBlock,
            { backgroundColor: colors.subtle, borderColor: colors.line },
          ]}
        >
          {/* Token + Call ID + Live Holding Quote or Settled PnL */}
          <View style={s.rowBetween}>
            <View style={s.tokenRow}>
              <Text style={[TYPE.title, { color: colors.ink }]}>${call.token.symbol}</Text>
              <Text style={[TYPE.caption, TYPE.num, { color: colors.ink3 }]}>
                Call #{call.callId}
              </Text>
            </View>

            {call.state === 'Settled' ? (
              <PnLText bps={call.netReturnBps} size="lg" />
            ) : call.state === 'Holding' && call.liveQuoteNetBps !== null ? (
              <PnLText bps={call.liveQuoteNetBps} size="md" suffix="live" />
            ) : null}
          </View>

          {/* 3 Tinted RuleChips + Lock ("Fixed at open") */}
          <View style={s.rulesRow}>
            <RuleChip kind="tp" label={tpLabel} />
            <RuleChip kind="sl" label={slLabel} />
            <RuleChip kind="time" label={maxTimeLabel} />

            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRulesSheetOpen(true);
              }}
              hitSlop={8}
              style={s.lockBtn}
              accessibilityRole="button"
              accessibilityLabel="Rules fixed at open, tap for fee and immutability details"
            >
              <Lock size={12} color={colors.ink3} strokeWidth={2} />
              <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '500' }]}>
                Fixed at open
              </Text>
            </Pressable>
          </View>

          {/* Signature Skin-in-the-Game PoolBar */}
          <PoolBar
            totalInLamports={call.totalInLamports}
            callerStakeLamports={call.callerStakeLamports}
            liveCapLamports={call.liveCapLamports}
            depositorsCount={call.depositorsCount}
          />

          {/* Refunded neutral one-liner */}
          {call.state === 'Refunded' && (
            <Text style={[TYPE.caption, { color: colors.ink3, marginTop: 2 }]}>
              {refundExplanation(call.settleReason)}
            </Text>
          )}
        </View>

        {/* 4. Actions Row (Quiet Threads icons on left + ONE prominent primary CTA on right) */}
        <View style={s.actionsRow}>
          <View style={s.quietGroup}>
            <Pressable
              onPress={() => onPressCard(call)}
              style={s.quietAction}
              accessibilityRole="button"
              accessibilityLabel={`${call.replies.length} replies`}
            >
              <MessageCircle size={17} color={colors.ink2} strokeWidth={1.8} />
              <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink2 }]}>
                {call.replies.length}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => onToggleWatch(call.callId)}
              style={s.quietAction}
              accessibilityRole="button"
              accessibilityLabel={isWatching ? 'Notifications on' : 'Notify me on pool updates'}
            >
              {isWatching ? (
                <BellRing size={17} color={colors.accent} strokeWidth={2} />
              ) : (
                <Bell size={17} color={colors.ink2} strokeWidth={1.8} />
              )}
              <Text
                style={[
                  TYPE.caption,
                  { color: isWatching ? colors.accent : colors.ink2, fontWeight: isWatching ? '600' : '500' },
                ]}
              >
                {isWatching ? 'Alerts on' : 'Notify'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => onShare(call)}
              style={s.quietAction}
              accessibilityRole="button"
              accessibilityLabel="Share call"
            >
              <Share2 size={17} color={colors.ink2} strokeWidth={1.8} />
              <Text style={[TYPE.caption, { color: colors.ink2 }]}>Share</Text>
            </Pressable>
          </View>

          {windowOpen ? (
            <PrimaryButton
              label="Join pool"
              compact
              disabled={busy}
              onPress={() => onPressJoin(call)}
            />
          ) : readyForCallerBuy && onPressBuy ? (
            <PrimaryButton
              label="Execute buy"
              compact
              disabled={busy}
              icon={<Zap size={14} color="#FFFFFF" strokeWidth={2.2} />}
              onPress={() => onPressBuy(call)}
            />
          ) : null}
        </View>

        {/* Optional Latest Reply Preview (In Pool vs Spectator) */}
        {latestReply && (
          <View style={[s.replyPreview, { borderTopColor: colors.line }]}>
            <View style={s.replyHeader}>
              <Text style={[TYPE.micro, { color: colors.ink }]}>
                {displayIdentity(latestReply.author, latestReply.authorSkr)}
              </Text>
              <View
                style={[
                  s.skinPill,
                  {
                    backgroundColor:
                      BigInt(latestReply.depositedLamports) > 0n
                        ? colors.openFill
                        : colors.subtle,
                  },
                ]}
              >
                <Text
                  style={[
                    TYPE.micro,
                    TYPE.num,
                    {
                      fontSize: 10,
                      color:
                        BigInt(latestReply.depositedLamports) > 0n
                          ? colors.openText
                          : colors.ink3,
                    },
                  ]}
                >
                  {BigInt(latestReply.depositedLamports) > 0n
                    ? `In Pool · ${formatSolFloor(latestReply.depositedLamports, 2)} SOL`
                    : 'Spectator'}
                </Text>
              </View>
            </View>
            <Text numberOfLines={2} style={[TYPE.caption, { color: colors.ink2 }]}>
              {latestReply.body}
            </Text>
          </View>
        )}
      </Pressable>

      {/* Tier Explainer BottomSheet */}
      <BottomSheet
        visible={tierSheetOpen}
        onClose={() => setTierSheetOpen(false)}
        title={call.callerSeekerVerified ? 'Seeker Verified Caller' : 'Unverified Wallet (Tier 0)'}
        subtitle={displayIdentity(call.caller, call.callerSkr)}
      >
        <View
          style={[
            s.infoBox,
            { backgroundColor: colors.subtle, borderColor: colors.line },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ShieldCheck
              size={18}
              color={call.callerSeekerVerified ? colors.open : colors.ink3}
              strokeWidth={2}
            />
            <Text style={[TYPE.bodySemi, { color: colors.ink, flex: 1 }]}>
              {tierExplainer.title}
            </Text>
          </View>
          <Text style={[TYPE.caption, { color: colors.ink2, marginTop: 6 }]}>
            {tierExplainer.body}
          </Text>
        </View>
        <SecondaryButton label="Got it" onPress={() => setTierSheetOpen(false)} />
      </BottomSheet>

      {/* Immutable Rules & Fee Breakdown BottomSheet */}
      <BottomSheet
        visible={rulesSheetOpen}
        onClose={() => setRulesSheetOpen(false)}
        title="Immutable Pool Rules"
        subtitle={`Locked at open on Call #${call.callId} ($${call.token.symbol})`}
      >
        <View
          style={[
            s.infoBox,
            { backgroundColor: colors.subtle, borderColor: colors.line, gap: SPACING.sm },
          ]}
        >
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Take-profit target</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.gainText }]}>{tpLabel}</Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Stop-loss floor</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.lossText }]}>{slLabel}</Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Max hold window</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>{maxTimeLabel}</Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Caller profit fee (wins only)</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
              {(call.rules.shareBps / 100).toFixed(1)}%
            </Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Keeper execution reward</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
              {(call.rules.keeperBps / 100).toFixed(2)}%
            </Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>Caller minimum pool share</Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
              ≥{(call.rules.minCallerBps / 100).toFixed(0)}%
            </Text>
          </View>
          {call.callerAvgNetBps !== null && (
            <View style={s.rowBetween}>
              <Text style={[TYPE.caption, { color: colors.ink3 }]}>Caller historical avg</Text>
              <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                {formatSignedPct(call.callerAvgNetBps)}
              </Text>
            </View>
          )}
        </View>
        <Text style={[TYPE.caption, { color: colors.ink3 }]}>
          Once a call opens on Solana, neither the caller nor followers can edit TP, SL, fee, or
          exit early ahead of the pool. Everyone enters in one swap and exits in one swap.
        </Text>
        <SecondaryButton label="Close" onPress={() => setRulesSheetOpen(false)} />
      </BottomSheet>
    </>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  callerTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  identityLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  profanityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  poolBlock: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm + 2,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  rulesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginLeft: 'auto',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginTop: -2,
  },
  quietGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  quietAction: {
    minHeight: MIN_TOUCH_TARGET - 4,
    paddingHorizontal: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: RADII.sm,
  },
  replyPreview: {
    paddingTop: SPACING.sm + 2,
    borderTopWidth: 1,
    gap: 4,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  skinPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADII.xs,
  },
  infoBox: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
});
