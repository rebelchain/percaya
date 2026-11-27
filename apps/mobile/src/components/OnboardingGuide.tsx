import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OnboardingStepId, OnboardingStepItem } from '../onboarding';

const INK = '#0F1D24';
const INK2 = '#364852';
const INK3 = '#66777F';
const ACCENT = '#1F6E9C';
const ACCENT_DEEP = '#123F5A';
const ACCENT_FILL = '#DBEAF4';
const ACCENT_SOFT = '#EDF5FA';
const GAIN = '#0A8A5F';
const GAIN_FILL = '#DCF3E8';
const LINE = '#E2E8EC';

/**
 * Calm 3-pillar first-launch Welcome Sheet (re-openable anytime via the `?` header button).
 */
export function WelcomeModal(props: {
  visible: boolean;
  connected: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  const { visible, connected, onClose, onConnect } = props;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.pillRow}>
            <View style={s.pill}>
              <Text style={s.pillText}>SOLANA MOBILE SEEKER · QUICK GUIDE</Text>
            </View>
          </View>

          <Text style={s.title}>One buy. One sale. The same price for everyone.</Text>
          <Text style={s.lead}>
            percaya turns mobile token calls into accountable on-chain pools—built natively for a
            phone in your pocket.
          </Text>

          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 10 }}>
            <View style={s.pointCard}>
              <Text style={s.pointTitle}>1 · No Free Shilling (Call-as-a-Thread)</Text>
              <Text style={s.pointBody}>
                Every root post locks the caller&apos;s own SOL (≥5% of pool) under immutable TP/SL
                rules. Replies auto-tag &ldquo;In Pool&rdquo; vs &ldquo;Spectator&rdquo;.
              </Text>
            </View>

            <View style={s.pointCard}>
              <Text style={s.pointTitle}>2 · Seeker Hardware Reputation (Token-2022 SGT)</Text>
              <Text style={s.pointBody}>
                Tiers 1–3 (5×–20× pool cap) bind a 1-per-device Seeker Genesis NFT to an on-chain
                GenesisRegistry PDA—closing burner-wallet resets.
              </Text>
            </View>

            <View style={s.pointCard}>
              <Text style={s.pointTitle}>3 · Native Camera QR & Push Alerts</Text>
              <Text style={s.pointBody}>
                Scan Call QRs in person via your phone camera, sign in one swipe via MWA 2.0, and
                receive Android notifications when pools settle.
              </Text>
            </View>
          </ScrollView>

          <View style={s.actions}>
            {!connected && (
              <Pressable
                style={s.primaryBtn}
                onPress={() => {
                  onClose();
                  onConnect();
                }}
              >
                <Text style={s.primaryBtnText}>Connect Wallet (MWA 2.0)</Text>
              </Pressable>
            )}
            <Pressable style={s.secondaryBtn} onPress={onClose}>
              <Text style={s.secondaryBtnText}>
                {connected ? 'Back to App' : 'Explore Live Devnet Feed First'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Dismissible 4-step interactive onboarding checklist at the top of Home.
 * Guides judges and first-time users through Connect -> Faucet -> Verify SGT -> Open/Scan Call.
 */
export function JudgeChecklistCard(props: {
  steps: OnboardingStepItem[];
  completedCount: number;
  busy: boolean;
  onAction: (id: OnboardingStepId) => void;
  onDismiss: () => void;
}) {
  const { steps, completedCount, busy, onAction, onDismiss } = props;
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View>
          <Text style={s.cardTitle}>Getting Started · {completedCount}/4</Text>
          <Text style={s.cardSub}>Interactive Solana Devnet walkthrough (zero local setup)</Text>
        </View>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={s.dismissText}>Hide</Text>
        </Pressable>
      </View>

      <View style={{ gap: 8, marginTop: 8 }}>
        {steps.map((step) => (
          <View key={step.id} style={s.stepRow}>
            <View style={[s.checkCircle, step.done && s.checkCircleDone]}>
              <Text style={[s.checkMark, step.done && s.checkMarkDone]}>
                {step.done ? '✓' : '•'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.stepTitle, step.done && s.stepTitleDone]}>{step.title}</Text>
              <Text style={s.stepSub}>{step.subtitle}</Text>
            </View>
            {!step.done && (
              <Pressable
                style={s.stepBtn}
                disabled={busy}
                onPress={() => onAction(step.id)}
              >
                <Text style={s.stepBtnText}>{step.ctaLabel}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,29,36,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  pillRow: { flexDirection: 'row' },
  pill: {
    backgroundColor: ACCENT_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 10, fontWeight: '700', color: ACCENT_DEEP, letterSpacing: 0.5 },
  title: { fontSize: 19, fontWeight: '700', color: INK, lineHeight: 25 },
  lead: { fontSize: 13, color: INK2, lineHeight: 19 },
  pointCard: {
    backgroundColor: '#F6F8FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    padding: 12,
    gap: 3,
  },
  pointTitle: { fontSize: 13, fontWeight: '700', color: INK },
  pointBody: { fontSize: 12, color: INK2, lineHeight: 17 },
  actions: { gap: 8, marginTop: 4 },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    backgroundColor: '#F6F8FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnText: { color: INK, fontWeight: '600', fontSize: 13 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT_FILL,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: INK },
  cardSub: { fontSize: 11, color: INK3, marginTop: 1 },
  dismissText: { fontSize: 12, fontWeight: '600', color: ACCENT },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F2F5F7',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F2F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleDone: { backgroundColor: GAIN_FILL },
  checkMark: { fontSize: 12, fontWeight: '700', color: INK3 },
  checkMarkDone: { color: GAIN },
  stepTitle: { fontSize: 12, fontWeight: '700', color: INK },
  stepTitleDone: { color: GAIN },
  stepSub: { fontSize: 11, color: INK3, lineHeight: 15 },
  stepBtn: {
    backgroundColor: ACCENT_FILL,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stepBtnText: { fontSize: 11, fontWeight: '700', color: ACCENT_DEEP },
});
