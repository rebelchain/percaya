import {
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  type CallDetail,
} from '@percaya/core';
import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildCallDeepLink } from '../call-links';
import { formatDurationCompact } from '../theme/format';
import { RADII, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from './ui/BottomSheet';
import { Share2 } from './ui/icons';
import {
  Avatar,
  PnLText,
  PrimaryButton,
  RuleChip,
  SecondaryButton,
  StatusPill,
  TierBadge,
} from './ui/primitives';

export function ResultCardSheet({
  call,
  visible,
  onClose,
}: {
  call: CallDetail | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  if (!call) return null;

  const deepLink = buildCallDeepLink(call.callId);
  const tpLabel =
    call.rules.takeProfitBps > 0
      ? `TP +${(call.rules.takeProfitBps / 100).toFixed(0)}%`
      : 'TP Open';
  const slLabel = `SL −${(call.rules.stopLossBps / 100).toFixed(0)}%`;
  const maxTimeLabel = `Max ${formatDurationCompact(call.rules.maxHoldSec)}`;

  const handleShareResult = async () => {
    const pct = formatSignedPct(call.netReturnBps);
    await Share.share({
      message: `percaya Settled Call #${call.callId} on $${call.token.symbol} (${pct}) by ${displayIdentity(call.caller, call.callerSkr)} — Verified on Solana: ${deepLink}`,
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="On-Chain Result Card"
      subtitle="Permanent settled record — wins and losses shown equally"
    >
      <View
        style={[
          s.poster,
          { backgroundColor: colors.subtle, borderColor: colors.lineStrong },
        ]}
      >
        {/* Brand Top Row */}
        <View style={s.rowBetween}>
          <View style={s.brandRow}>
            <View style={[s.vesselMark, { borderColor: colors.ink }]}>
              <View style={[s.vesselLine, { backgroundColor: colors.accent }]} />
            </View>
            <Text style={[TYPE.bodySemi, { color: colors.ink }]}>percaya</Text>
          </View>
          <StatusPill state={call.state} netReturnBps={call.netReturnBps} compact />
        </View>

        {/* Big Token + PnL Hero */}
        <View style={s.heroRow}>
          <View style={{ flex: 1 }}>
            <Text style={[TYPE.display, { color: colors.ink, fontSize: 28, lineHeight: 34 }]}>
              ${call.token.symbol}
            </Text>
            <Text style={[TYPE.caption, TYPE.num, { color: colors.ink3 }]}>
              Call #{call.callId} · {formatSolFloor(call.totalInLamports, 3)} SOL pool
            </Text>
          </View>
          <PnLText bps={call.netReturnBps} size="lg" />
        </View>

        {/* Locked Rules */}
        <View style={s.rulesRow}>
          <RuleChip kind="tp" label={tpLabel} />
          <RuleChip kind="sl" label={slLabel} />
          <RuleChip kind="time" label={maxTimeLabel} />
        </View>

        {/* Caller + QR Footer */}
        <View style={[s.footerRow, { borderTopColor: colors.line }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <Avatar seed={call.caller} size={36} />
            <View style={{ gap: 2, flex: 1 }}>
              <Text numberOfLines={1} style={[TYPE.captionSemi, { color: colors.ink }]}>
                {displayIdentity(call.caller, call.callerSkr)}
              </Text>
              <TierBadge
                verified={call.callerSeekerVerified}
                tier={call.callerTier}
              />
            </View>
          </View>

          <View style={s.qrWrap}>
            <QRCode value={deepLink} size={64} color="#0F1D24" backgroundColor="#FFFFFF" />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <SecondaryButton label="Close" onPress={onClose} />
        <PrimaryButton
          label="Share Result"
          icon={<Share2 size={16} color="#FFFFFF" strokeWidth={2} />}
          onPress={handleShareResult}
          style={{ flex: 1 }}
        />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  poster: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vesselMark: {
    width: 18,
    height: 16,
    borderWidth: 1.8,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  vesselLine: {
    height: 2,
    width: '100%',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingVertical: 4,
  },
  rulesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
  },
  qrWrap: {
    padding: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: RADII.sm,
  },
});
