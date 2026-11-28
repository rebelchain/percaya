import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADII, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from './ui/BottomSheet';
import { ShieldCheck, Smartphone, Wallet } from './ui/icons';
import { PrimaryButton } from './ui/primitives';

export interface ConnectSheetProps {
  visible: boolean;
  connecting: boolean;
  reason?: string | null;
  onClose: () => void;
  onConnect: () => void;
}

/**
 * Friendly unified wallet connection sheet (Phase 3).
 * Replaces technical MWA/SIWS paragraphs with one calm CTA and supported wallet badges.
 */
export function ConnectSheet({
  visible,
  connecting,
  reason,
  onClose,
  onConnect,
}: ConnectSheetProps) {
  const { colors } = useTheme();
  const wallets = __DEV__
    ? ['Seed Vault', 'Solflare', 'Phantom', 'Dev Fake Wallet']
    : ['Seed Vault', 'Solflare', 'Phantom'];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Connect wallet to continue"
      subtitle={reason || 'Sign in with your Solana wallet in one tap.'}
    >
      <View style={s.walletBadgesRow}>
        {wallets.map((w) => (
          <View
            key={w}
            style={[
              s.walletPill,
              { backgroundColor: colors.subtle, borderColor: colors.line },
            ]}
          >
            <Smartphone size={13} color={colors.accent} strokeWidth={2} />
            <Text style={[TYPE.micro, { color: colors.ink2 }]}>{w}</Text>
          </View>
        ))}
      </View>

      <View
        style={[
          s.trustRow,
          { backgroundColor: colors.subtle, borderColor: colors.line },
        ]}
      >
        <ShieldCheck size={16} color={colors.gain} strokeWidth={2} />
        <Text style={[TYPE.caption, { color: colors.ink2, flex: 1 }]}>
          Read-only sign-in. Nothing leaves your wallet until you explicitly approve a pool
          deposit or call stake.
        </Text>
      </View>

      <PrimaryButton
        label={connecting ? 'Opening wallet…' : 'Connect Wallet'}
        loading={connecting}
        icon={<Wallet size={17} color="#FFFFFF" strokeWidth={2} />}
        onPress={onConnect}
      />
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  walletBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
});
