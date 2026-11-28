import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OnboardingStepId, OnboardingStepItem } from '../onboarding';
import { RADII, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from './ui/BottomSheet';
import { Check, Lock, QrCode, ShieldCheck, Wallet } from './ui/icons';
import { PrimaryButton, SecondaryButton } from './ui/primitives';

/**
 * Calm 3-pillar Quick Guide BottomSheet (re-openable anytime via the `?` header icon).
 */
export function WelcomeModal(props: {
  visible: boolean;
  connected: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  const { visible, connected, onClose, onConnect } = props;
  const { colors } = useTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="One buy. One sale. Same price."
      subtitle="Accountable token call pools built for Solana Mobile Seeker."
    >
      <View style={{ gap: SPACING.sm }}>
        <View style={[s.pointCard, { backgroundColor: colors.subtle, borderColor: colors.line }]}>
          <View style={s.pointRow}>
            <Lock size={16} color={colors.accent} strokeWidth={2} />
            <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
              1 · Caller Skin in the Game
            </Text>
          </View>
          <Text style={[TYPE.caption, { color: colors.ink2 }]}>
            Every call locks the caller&apos;s own SOL (≥5% of pool) under immutable TP/SL rules.
            Replies show &ldquo;In Pool&rdquo; vs &ldquo;Spectator&rdquo;.
          </Text>
        </View>

        <View style={[s.pointCard, { backgroundColor: colors.subtle, borderColor: colors.line }]}>
          <View style={s.pointRow}>
            <ShieldCheck size={16} color={colors.gain} strokeWidth={2} />
            <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
              2 · Hardware-Bound Track Record
            </Text>
          </View>
          <Text style={[TYPE.caption, { color: colors.ink2 }]}>
            Verifying with Seeker binds one permanent record per device, unlocking Tiers 1–3 (5×–20×
            pool cap) and blocking burner-wallet resets.
          </Text>
        </View>

        <View style={[s.pointCard, { backgroundColor: colors.subtle, borderColor: colors.line }]}>
          <View style={s.pointRow}>
            <QrCode size={16} color={colors.open} strokeWidth={2} />
            <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
              3 · Scan QR, Join & Claim Pro-Rata
            </Text>
          </View>
          <Text style={[TYPE.caption, { color: colors.ink2 }]}>
            Scan Call QR codes in person, join open windows in one tap, and receive push alerts when
            checkpoints settle.
          </Text>
        </View>
      </View>

      <View style={{ gap: SPACING.sm }}>
        {!connected && (
          <PrimaryButton
            label="Connect Wallet"
            icon={<Wallet size={16} color="#FFFFFF" strokeWidth={2} />}
            onPress={() => {
              onClose();
              onConnect();
            }}
          />
        )}
        <SecondaryButton
          label={connected ? 'Back to Feed' : 'Browse Live Feed First'}
          onPress={onClose}
        />
      </View>
    </BottomSheet>
  );
}

/**
 * Dismissible 4-step interactive Getting Started card at the top of Home.
 */
export function JudgeChecklistCard(props: {
  steps: OnboardingStepItem[];
  completedCount: number;
  busy: boolean;
  onAction: (id: OnboardingStepId) => void;
  onDismiss: () => void;
}) {
  const { steps, completedCount, busy, onAction, onDismiss } = props;
  const { colors } = useTheme();

  return (
    <View
      style={[
        s.card,
        { backgroundColor: colors.surface, borderColor: colors.openFill },
      ]}
    >
      <View style={s.cardHeader}>
        <View>
          <Text style={[TYPE.bodySemi, { color: colors.ink, fontSize: 14 }]}>
            Getting Started · {completedCount}/4
          </Text>
          <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
            Quick Solana Devnet setup
          </Text>
        </View>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={[TYPE.captionSemi, { color: colors.accent, fontSize: 12 }]}>Hide</Text>
        </Pressable>
      </View>

      <View style={{ gap: 6 }}>
        {steps.map((step) => (
          <View
            key={step.id}
            style={[s.stepRow, { borderTopColor: colors.line }]}
          >
            <View
              style={[
                s.checkCircle,
                { backgroundColor: step.done ? colors.gainFill : colors.subtle },
              ]}
            >
              {step.done ? (
                <Check size={13} color={colors.gain} strokeWidth={2.5} />
              ) : (
                <View style={[s.pendingDot, { backgroundColor: colors.ink3 }]} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  TYPE.captionSemi,
                  { color: step.done ? colors.gainText : colors.ink, fontSize: 12 },
                ]}
              >
                {step.title}
              </Text>
              <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                {step.subtitle}
              </Text>
            </View>
            {!step.done && (
              <Pressable
                style={[s.stepBtn, { backgroundColor: colors.openFill }]}
                disabled={busy}
                onPress={() => onAction(step.id)}
              >
                <Text style={[TYPE.micro, { color: colors.openText }]}>{step.ctaLabel}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pointCard: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 4,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1.5,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  stepBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.sm,
  },
});
