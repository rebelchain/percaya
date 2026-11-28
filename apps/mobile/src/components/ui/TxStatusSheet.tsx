import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RADII, SPACING, TYPE } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { BottomSheet } from './BottomSheet';
import { AlertTriangle, CheckCircle2, Wallet } from './icons';
import { PrimaryButton, SecondaryButton } from './primitives';

export type TxLifecycleStage = 'idle' | 'signing' | 'confirming' | 'confirmed' | 'error';

export interface TxStatusState {
  stage: TxLifecycleStage;
  title: string;
  subtitle?: string;
  txSig?: string | null;
  errorMessage?: string | null;
  onRetry?: (() => void) | null;
}

export function TxStatusSheet({
  status,
  onClose,
}: {
  status: TxStatusState;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const visible = status.stage !== 'idle';

  const canDismiss = status.stage === 'confirmed' || status.stage === 'error';

  return (
    <BottomSheet
      visible={visible}
      onClose={canDismiss ? onClose : () => {}}
      title={status.title}
      subtitle={status.subtitle}
    >
      {/* 2-Step Progress Strip when active */}
      {(status.stage === 'signing' || status.stage === 'confirming') && (
        <View style={[s.stageBox, { backgroundColor: colors.subtle, borderColor: colors.line }]}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[TYPE.bodySemi, { color: colors.ink }]}>
              {status.stage === 'signing'
                ? '1/2 · Approve in your Solana wallet'
                : '2/2 · Confirming on Solana Devnet…'}
            </Text>
            <Text style={[TYPE.caption, { color: colors.ink3 }]}>
              {status.stage === 'signing'
                ? 'Review the transaction details and swipe to sign.'
                : 'Waiting for Devnet block confirmation.'}
            </Text>
          </View>
          <Wallet size={18} color={colors.accent} strokeWidth={2} />
        </View>
      )}

      {status.stage === 'confirmed' && (
        <View style={{ gap: SPACING.md }}>
          <View
            style={[
              s.stageBox,
              { backgroundColor: colors.gainFill, borderColor: colors.gain },
            ]}
          >
            <CheckCircle2 size={22} color={colors.gain} strokeWidth={2.2} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[TYPE.bodySemi, { color: colors.gainText }]}>
                Confirmed on Solana Devnet
              </Text>
              {status.txSig && (
                <Text selectable style={[TYPE.micro, TYPE.num, { color: colors.gainText }]}>
                  Tx: {status.txSig.slice(0, 22)}…
                </Text>
              )}
            </View>
          </View>
          <PrimaryButton label="Done" onPress={onClose} />
        </View>
      )}

      {status.stage === 'error' && (
        <View style={{ gap: SPACING.md }}>
          <View
            style={[
              s.stageBox,
              { backgroundColor: colors.lossFill, borderColor: colors.loss },
            ]}
          >
            <AlertTriangle size={20} color={colors.lossText} strokeWidth={2.1} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[TYPE.bodySemi, { color: colors.lossText }]}>
                Transaction did not complete
              </Text>
              <Text style={[TYPE.caption, { color: colors.lossText }]}>
                {status.errorMessage || 'The wallet request was cancelled or rejected.'}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <SecondaryButton label="Close" onPress={onClose} style={{ flex: 1 }} />
            {status.onRetry && (
              <PrimaryButton
                label="Retry"
                onPress={() => {
                  const retry = status.onRetry;
                  onClose();
                  retry?.();
                }}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  stageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
});
