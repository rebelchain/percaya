import { displayIdentity } from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SeekerSession } from '../../mwa';
import { MIN_TOUCH_TARGET, RADII, SPACING, TYPE } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { HelpCircle, QrCode, Wallet } from './icons';
import { Avatar } from './primitives';

export type ScreenTabKey = 'home' | 'explore' | 'compose' | 'activity' | 'profile';

const SCREEN_TITLES: Record<ScreenTabKey, string> = {
  home: 'percaya',
  explore: 'Callers',
  compose: 'Create Call',
  activity: 'Activity',
  profile: 'Profile',
};

export function TopHeader({
  tab,
  apiMode,
  session,
  balanceSol,
  connecting,
  onOpenGuide,
  onOpenScanner,
  onPressWallet,
}: {
  tab: ScreenTabKey;
  apiMode: 'demo' | 'chain' | 'offline';
  session: SeekerSession | null;
  balanceSol: number | null;
  connecting: boolean;
  onOpenGuide: () => void;
  onOpenScanner: () => void;
  onPressWallet: () => void;
}) {
  const { colors } = useTheme();
  const isHome = tab === 'home';

  return (
    <View style={[s.bar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
      <View style={s.leftRow}>
        <View style={[s.vesselMark, { borderColor: colors.ink }]}>
          <View style={[s.vesselLine, { backgroundColor: colors.accent }]} />
        </View>
        <Text style={[TYPE.title, { color: colors.ink, fontSize: isHome ? 19 : 17 }]}>
          {SCREEN_TITLES[tab]}
        </Text>
        <View
          style={[
            s.netChip,
            {
              backgroundColor:
                apiMode === 'chain'
                  ? colors.gainFill
                  : apiMode === 'demo'
                    ? colors.openFill
                    : colors.refundedFill,
            },
          ]}
        >
          <View
            style={[
              s.netDot,
              {
                backgroundColor:
                  apiMode === 'chain'
                    ? colors.gain
                    : apiMode === 'demo'
                      ? colors.open
                      : colors.refunded,
              },
            ]}
          />
          <Text
            style={[
              TYPE.micro,
              {
                fontSize: 10,
                color:
                  apiMode === 'chain'
                    ? colors.gainText
                    : apiMode === 'demo'
                      ? colors.openText
                      : colors.refundedText,
              },
            ]}
          >
            {apiMode === 'chain' ? 'Devnet' : apiMode === 'demo' ? 'Preview' : 'Syncing'}
          </Text>
        </View>
      </View>

      <View style={s.rightRow}>
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenGuide();
          }}
          style={[s.iconBtn, { backgroundColor: colors.subtle }]}
          accessibilityRole="button"
          accessibilityLabel="Quick guide"
        >
          <HelpCircle size={18} color={colors.ink2} strokeWidth={1.9} />
        </Pressable>

        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenScanner();
          }}
          style={[s.iconBtn, { backgroundColor: colors.openFill }]}
          accessibilityRole="button"
          accessibilityLabel="Scan Call QR code"
        >
          <QrCode size={18} color={colors.openText} strokeWidth={1.9} />
        </Pressable>

        {session ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPressWallet();
            }}
            style={[
              s.walletChip,
              { backgroundColor: colors.subtle, borderColor: colors.lineStrong },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open connected wallet profile"
          >
            <Avatar seed={session.pubkey} size={22} />
            <View style={{ maxWidth: 112 }}>
              <Text
                numberOfLines={1}
                style={[TYPE.micro, { color: colors.ink, fontSize: 12 }]}
              >
                {displayIdentity(session.pubkey, session.skrName)}
              </Text>
              {balanceSol !== null && (
                <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontSize: 10 }]}>
                  {balanceSol.toFixed(2)} SOL
                </Text>
              )}
            </View>
          </Pressable>
        ) : (
          <Pressable
            disabled={connecting}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPressWallet();
            }}
            style={[s.connectBtn, { backgroundColor: colors.ink, opacity: connecting ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Connect wallet"
          >
            <Wallet size={14} color={colors.onPrimary} strokeWidth={2} />
            <Text style={[TYPE.captionSemi, { color: colors.onPrimary, fontSize: 12 }]}>
              {connecting ? 'Connecting…' : 'Connect'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    minHeight: 54,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  vesselMark: {
    width: 20,
    height: 18,
    borderWidth: 1.8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  vesselLine: {
    height: 2,
    width: '100%',
  },
  netChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.pill,
  },
  netDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 38,
    height: 38,
    minWidth: MIN_TOUCH_TARGET - 6,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
    minHeight: 38,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  connectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 38,
    borderRadius: RADII.pill,
  },
});
