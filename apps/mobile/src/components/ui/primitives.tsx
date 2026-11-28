import { formatSignedPct, formatSolFloor, type CallState } from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { formatCountdownShort, getIdenticonSpec } from '../../theme/format';
import { MIN_TOUCH_TARGET, RADII, SPACING, TYPE } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { Clock, ShieldCheck, TrendingDown, TrendingUp } from './icons';

/**
 * Deterministic 2-tone SVG geometric gradient identicon.
 * Replaces plain single-letter circles with recognizable trader visual anchors.
 */
export function Avatar({
  seed,
  size = 38,
}: {
  seed: string;
  size?: number;
}) {
  const spec = getIdenticonSpec(seed);
  const gradId = `av-${seed.slice(0, 6)}-${size}`;
  const half = size / 2;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: half,
        overflow: 'hidden',
      }}
      accessibilityElementsHidden
    >
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={spec.startColor} />
            <Stop offset="100%" stopColor={spec.endColor} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="40" height="40" rx="20" fill={`url(#${gradId})`} />
        {spec.shapeIndex === 0 && (
          <>
            <Circle cx="28" cy="12" r="11" fill={spec.accentColor} opacity={0.32} />
            <Circle cx="12" cy="29" r="9" fill="#FFFFFF" opacity={0.18} />
          </>
        )}
        {spec.shapeIndex === 1 && (
          <>
            <Path d="M0 26 Q20 14 40 28 L40 40 L0 40 Z" fill={spec.accentColor} opacity={0.3} />
            <Circle cx="20" cy="14" r="6" fill="#FFFFFF" opacity={0.22} />
          </>
        )}
        {spec.shapeIndex === 2 && (
          <>
            <Rect
              x="10"
              y="10"
              width="20"
              height="20"
              rx="6"
              rotation={spec.angleDeg % 45}
              origin="20, 20"
              fill={spec.accentColor}
              opacity={0.28}
            />
            <Circle cx="20" cy="20" r="4.5" fill="#FFFFFF" opacity={0.3} />
          </>
        )}
        {spec.shapeIndex === 3 && (
          <>
            <Circle cx="20" cy="20" r="13" stroke={spec.accentColor} strokeWidth="3.5" fill="none" opacity={0.38} />
            <Circle cx="20" cy="20" r="5" fill="#FFFFFF" opacity={0.26} />
          </>
        )}
      </Svg>
    </View>
  );
}

/**
 * Semantic status pill:
 * Open = Blue (+ live time left), Holding = Amber, Settled profit = Green, Settled loss = Red, Refunded = Gray.
 */
export function StatusPill({
  state,
  netReturnBps,
  windowEnd,
  nowSec,
  compact = false,
}: {
  state: CallState;
  netReturnBps?: number | null;
  windowEnd?: number;
  nowSec?: number;
  compact?: boolean;
}) {
  const { colors } = useTheme();

  let bg = colors.refundedFill;
  let fg = colors.refundedText;
  let dot = colors.refunded;
  let label: string = state;
  let showLiveDot = false;

  if (state === 'Open') {
    bg = colors.openFill;
    fg = colors.openText;
    dot = colors.open;
    showLiveDot = true;
    if (windowEnd && !compact) {
      const countdown = formatCountdownShort(windowEnd, nowSec);
      label = countdown ? `Open · ${countdown}` : 'Open · Window closed';
    } else {
      label = 'Open';
    }
  } else if (state === 'Holding') {
    bg = colors.holdingFill;
    fg = colors.holdingText;
    dot = colors.holding;
    showLiveDot = true;
    label = 'Holding';
  } else if (state === 'Settled') {
    const bps = netReturnBps ?? 0;
    if (bps > 0) {
      bg = colors.gainFill;
      fg = colors.gainText;
      dot = colors.gain;
      label = 'Settled';
    } else if (bps < 0) {
      bg = colors.lossFill;
      fg = colors.lossText;
      dot = colors.loss;
      label = 'Settled';
    } else {
      bg = colors.refundedFill;
      fg = colors.refundedText;
      label = 'Settled';
    }
  } else if (state === 'Refunded') {
    bg = colors.refundedFill;
    fg = colors.refundedText;
    label = 'Refunded';
  } else if (state === 'Split') {
    bg = colors.refundedFill;
    fg = colors.refundedText;
    label = 'Split';
  }

  return (
    <View style={[s.statusPill, { backgroundColor: bg }]}>
      {showLiveDot && <View style={[s.liveDot, { backgroundColor: dot }]} />}
      <Text style={[TYPE.micro, TYPE.num, { color: fg }]}>{label}</Text>
    </View>
  );
}

/**
 * RuleChip: renders TP (green-tint), SL (red-tint), or Max Hold Time (neutral) with crisp line icon.
 */
export function RuleChip({
  kind,
  label,
}: {
  kind: 'tp' | 'sl' | 'time';
  label: string;
}) {
  const { colors } = useTheme();
  const cfg =
    kind === 'tp'
      ? { bg: colors.gainFill, fg: colors.gainText, Icon: TrendingUp }
      : kind === 'sl'
        ? { bg: colors.lossFill, fg: colors.lossText, Icon: TrendingDown }
        : { bg: colors.subtle, fg: colors.ink2, Icon: Clock };

  return (
    <View
      style={[
        s.ruleChip,
        {
          backgroundColor: cfg.bg,
          borderColor: kind === 'time' ? colors.line : 'transparent',
        },
      ]}
    >
      <cfg.Icon size={13} color={cfg.fg} strokeWidth={2} />
      <Text style={[TYPE.captionSemi, TYPE.num, { color: cfg.fg, fontSize: 12 }]}>{label}</Text>
    </View>
  );
}

/**
 * Signature "Skin in the Game" PoolBar:
 * Shows total pool SOL, Caller's exact share % vs Followers, and pool capacity fill.
 */
export function PoolBar({
  totalInLamports,
  callerStakeLamports,
  liveCapLamports,
  depositorsCount,
}: {
  totalInLamports: string;
  callerStakeLamports: string;
  liveCapLamports: string;
  depositorsCount: number;
}) {
  const { colors } = useTheme();
  const totalN = BigInt(totalInLamports || '0');
  const callerN = BigInt(callerStakeLamports || '0');
  const capN = BigInt(liveCapLamports || '0');

  const callerPct =
    totalN > 0n ? Math.min(100, Math.max(1, Math.round((Number(callerN) / Number(totalN)) * 100))) : 100;
  const followerPct = Math.max(0, 100 - callerPct);
  const followersCount = Math.max(0, depositorsCount - 1);

  return (
    <View style={{ gap: SPACING.xs + 2 }}>
      <View style={s.rowBetween}>
        <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
          Pool {formatSolFloor(totalN, 3)} SOL{' '}
          <Text style={{ color: colors.ink3, fontWeight: '500' }}>
            · Caller {callerPct}%
          </Text>
        </Text>
        <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3 }]}>
          {followersCount > 0
            ? `${followersCount} follower${followersCount === 1 ? '' : 's'}`
            : capN > 0n
              ? `Cap ${formatSolFloor(capN, 2)} SOL`
              : 'Caller staked'}
        </Text>
      </View>

      <View style={[s.poolTrack, { backgroundColor: colors.line }]}>
        <View
          style={[
            s.poolCallerSeg,
            {
              width: `${callerPct}%`,
              backgroundColor: colors.accent,
            },
          ]}
        />
        {followerPct > 0 && (
          <View
            style={[
              s.poolFollowerSeg,
              {
                width: `${followerPct}%`,
                backgroundColor: colors.gain,
              },
            ]}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Clean hardware verification badge (`✓ Seeker Verified` vs subtle `Unverified`).
 * Replaces internal "Seeker T0" / "Unverified T0" jargon.
 */
export function TierBadge({
  verified,
  tier,
  onPress,
}: {
  verified: boolean;
  tier?: number;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const content = (
    <View
      style={[
        s.tierBadge,
        verified
          ? { backgroundColor: colors.openFill }
          : { backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.line },
      ]}
    >
      {verified && <ShieldCheck size={12} color={colors.openText} strokeWidth={2.2} />}
      <Text
        style={[
          TYPE.micro,
          {
            color: verified ? colors.openText : colors.ink3,
            fontSize: 11,
          },
        ]}
      >
        {verified
          ? tier && tier > 0
            ? `Seeker Verified · Tier ${tier}`
            : 'Seeker Verified'
          : 'Unverified'}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={verified ? 'Seeker Verified hardware badge, tap for details' : 'Unverified wallet badge, tap for details'}
    >
      {content}
    </Pressable>
  );
}

/**
 * Robinhood-style semantic P/L percentage text (`+26.88%` green / `−12.00%` red).
 */
export function PnLText({
  bps,
  size = 'lg',
  suffix,
}: {
  bps: number | null | undefined;
  size?: 'lg' | 'md' | 'sm';
  suffix?: string;
}) {
  const { colors } = useTheme();
  const val = bps ?? 0;
  const color = val > 0 ? colors.gain : val < 0 ? colors.loss : colors.ink2;
  const typo = size === 'lg' ? TYPE.display : size === 'md' ? TYPE.title : TYPE.captionSemi;

  return (
    <Text style={[typo, TYPE.num, { color }]}>
      {formatSignedPct(bps)}
      {suffix ? (
        <Text style={[TYPE.caption, { color: colors.ink3 }]}>{` ${suffix}`}</Text>
      ) : null}
    </Text>
  );
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  icon,
  style,
  compact,
}: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        s.btnBase,
        compact && s.btnCompact,
        {
          backgroundColor: colors.accent,
          opacity: disabled || loading ? 0.52 : pressed ? 0.88 : 1,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <>
          {icon}
          <Text style={[TYPE.bodySemi, { color: '#FFFFFF', fontSize: compact ? 13 : 15 }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  loading,
  icon,
  style,
  compact,
}: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        s.btnBase,
        compact && s.btnCompact,
        {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.lineStrong,
          opacity: disabled || loading ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.ink} />
      ) : (
        <>
          {icon}
          <Text style={[TYPE.bodySemi, { color: colors.ink, fontSize: compact ? 13 : 15 }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  disabled,
  icon,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        s.ghostBtn,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
        style,
      ]}
      accessibilityRole="button"
    >
      {icon}
      <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Linear/Stripe-style segmented step bar (`Step 1 of 3` visual replacement).
 */
export function SegmentedProgress({
  currentStep,
  totalSteps = 3,
  title,
  subtitle,
}: {
  currentStep: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: SPACING.sm }}>
      <View style={s.segBarRow}>
        {Array.from({ length: totalSteps }).map((_, idx) => {
          const active = idx + 1 <= currentStep;
          return (
            <View
              key={idx}
              style={[
                s.segBarChunk,
                { backgroundColor: active ? colors.accent : colors.line },
              ]}
            />
          );
        })}
      </View>
      <View style={s.rowBetween}>
        <Text style={[TYPE.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3 }]}>
          {currentStep} / {totalSteps}
        </Text>
      </View>
      {subtitle ? (
        <Text style={[TYPE.caption, { color: colors.ink2 }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        s.emptyCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
      ]}
    >
      <View style={[s.emptyIconCircle, { backgroundColor: colors.subtle }]}>{icon}</View>
      <Text style={[TYPE.title, { color: colors.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[TYPE.caption, { color: colors.ink3, textAlign: 'center', maxWidth: 290 }]}>
        {body}
      </Text>
      {actionLabel && onAction && (
        <PrimaryButton
          label={actionLabel}
          onPress={onAction}
          compact
          style={{ marginTop: SPACING.xs }}
        />
      )}
    </View>
  );
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = RADII.sm,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
}) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (reduced) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.9, duration: 750, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.line,
        opacity,
      }}
    />
  );
}

export function CallCardSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        s.skelCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <Skeleton width={38} height={38} radius={19} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton width="52%" height={14} />
          <Skeleton width="34%" height={11} />
        </View>
        <Skeleton width={76} height={24} radius={RADII.pill} />
      </View>
      <Skeleton width="92%" height={15} />
      <Skeleton width="68%" height={15} />
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <Skeleton width={78} height={26} radius={RADII.sm} />
        <Skeleton width={78} height={26} radius={RADII.sm} />
        <Skeleton width={78} height={26} radius={RADII.sm} />
      </View>
      <Skeleton width="100%" height={48} radius={RADII.md} />
    </View>
  );
}

const s = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ruleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm + 1,
    paddingVertical: 5,
    borderRadius: RADII.sm,
    borderWidth: 1,
  },
  poolTrack: {
    height: 7,
    borderRadius: RADII.pill,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  poolCallerSeg: {
    height: '100%',
  },
  poolFollowerSeg: {
    height: '100%',
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.pill,
  },
  btnBase: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADII.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  btnCompact: {
    minHeight: 38,
    paddingHorizontal: SPACING.md + 2,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.sm + 2,
  },
  ghostBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACING.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  segBarRow: {
    flexDirection: 'row',
    gap: 6,
  },
  segBarChunk: {
    flex: 1,
    height: 4,
    borderRadius: RADII.pill,
  },
  emptyCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  skelCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
});
