import {
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  type CallDetail,
  type CallerRecord,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SeekerSession } from '../mwa';
import { RADII, SHADOWS, SPACING, TYPE, type ThemeMode } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from '../components/ui/BottomSheet';
import {
  CheckCircle2,
  ChevronRight,
  Coins,
  Info,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Wallet,
} from '../components/ui/icons';
import {
  Avatar,
  PnLText,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  TierBadge,
} from '../components/ui/primitives';

export interface ProfileScreenProps {
  session: SeekerSession | null;
  balanceSol: number | null;
  myCallerRecord: CallerRecord | null;
  isSeekerVerified: boolean;
  localSgtMint?: string | null;
  calls: CallDetail[];
  nowSec: number;
  connecting: boolean;
  funding: boolean;
  verifyingSgt: boolean;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onVerifySeeker: () => void;
  onClaimFaucet: () => void;
  onOpenCall: (call: CallDetail) => void;
  onClaimPosition: (call: CallDetail) => void;
}

export function ProfileScreen({
  session,
  balanceSol,
  myCallerRecord,
  isSeekerVerified,
  localSgtMint,
  calls,
  nowSec,
  connecting,
  funding,
  verifyingSgt,
  busy,
  refreshing,
  onRefresh,
  onConnect,
  onDisconnect,
  onVerifySeeker,
  onClaimFaucet,
  onOpenCall,
  onClaimPosition,
}: ProfileScreenProps) {
  const { colors, mode, setMode } = useTheme();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const myOpenPools = useMemo(() => {
    if (!session) return [];
    return calls.filter(
      (c) =>
        (c.state === 'Open' || c.state === 'Holding') &&
        (c.caller === session.pubkey ||
          c.positions.some(
            (p) => p.participant === session.pubkey && BigInt(p.depositedLamports) > 0n,
          )),
    );
  }, [calls, session]);

  const myClaimable = useMemo(() => {
    if (!session) return [];
    return calls
      .map((call) => {
        const pos = call.positions.find((p) => p.participant === session.pubkey);
        if (!pos || pos.claimed) return null;
        if (call.state !== 'Settled' && call.state !== 'Refunded' && call.state !== 'Split') {
          return null;
        }
        if (BigInt(pos.claimableAmount || '0') <= 0n) return null;
        return { call, pos };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [calls, session]);

  const settledCount = myCallerRecord?.settled ?? 0;
  const lossesCount = myCallerRecord?.losses ?? 0;
  const winsCount = Math.max(0, settledCount - lossesCount);
  const winRatePct = settledCount > 0 ? Math.round((winsCount / settledCount) * 100) : null;
  const tier = myCallerRecord?.tierInfo.tier ?? 0;
  const bondMult = myCallerRecord?.tierInfo.bondMultiple ?? 2;
  const maxFeePct = ((myCallerRecord?.tierInfo.maxShareBps ?? 500) / 100).toFixed(0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      {!session ? (
        /* Logged-out Value Pitch + Single Connect CTA */
        <View
          style={[
            s.card,
            SHADOWS.card,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <View style={[s.pitchIconWrap, { backgroundColor: colors.openFill }]}>
            <Wallet size={24} color={colors.openText} strokeWidth={2} />
          </View>
          <Text style={[TYPE.display, { color: colors.ink }]}>
            Your track record, anchored to hardware.
          </Text>
          <Text style={[TYPE.body, { color: colors.ink2 }]}>
            Connect your Solana wallet to join active call pools, claim pro-rata exits, or lock
            your own SOL to publish calls.
          </Text>

          <View style={s.bulletList}>
            <View style={s.bulletRow}>
              <Lock size={16} color={colors.accent} strokeWidth={2} />
              <Text style={[TYPE.caption, { color: colors.ink2, flex: 1 }]}>
                Same entry & exit price as the caller under immutable TP/SL rules
              </Text>
            </View>
            <View style={s.bulletRow}>
              <ShieldCheck size={16} color={colors.gain} strokeWidth={2} />
              <Text style={[TYPE.caption, { color: colors.ink2, flex: 1 }]}>
                Verify a Seeker Genesis device token to unlock Tiers 1–3 (up to 20× pool cap)
              </Text>
            </View>
            <View style={s.bulletRow}>
              <CheckCircle2 size={16} color={colors.open} strokeWidth={2} />
              <Text style={[TYPE.caption, { color: colors.ink2, flex: 1 }]}>
                Every outcome—wins and losses—is recorded permanently on-chain
              </Text>
            </View>
          </View>

          <PrimaryButton
            label={connecting ? 'Connecting…' : 'Connect Wallet'}
            loading={connecting}
            icon={<Wallet size={17} color="#FFFFFF" strokeWidth={2} />}
            onPress={onConnect}
          />
        </View>
      ) : (
        <>
          {/* 1. Identity & Balance Card */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <View style={s.rowBetween}>
              <View style={s.identityRow}>
                <Avatar seed={session.pubkey} size={48} />
                <View style={{ gap: 4 }}>
                  <Text style={[TYPE.title, { color: colors.ink }]}>
                    {displayIdentity(
                      session.pubkey,
                      myCallerRecord?.skrName ?? session.skrName,
                    )}
                  </Text>
                  <TierBadge verified={isSeekerVerified} tier={tier} />
                </View>
              </View>

              <Pressable
                onPress={() => setDetailsOpen(true)}
                style={[s.iconPill, { backgroundColor: colors.subtle }]}
                accessibilityRole="button"
                accessibilityLabel="Technical account details"
              >
                <Info size={15} color={colors.ink2} strokeWidth={2} />
                <Text style={[TYPE.micro, { color: colors.ink2 }]}>Details</Text>
              </Pressable>
            </View>

            <View
              style={[
                s.balanceStrip,
                { backgroundColor: colors.subtle, borderColor: colors.line },
              ]}
            >
              <View>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Wallet Balance</Text>
                <Text style={[TYPE.display, TYPE.num, { color: colors.ink, marginTop: 2 }]}>
                  {balanceSol !== null ? `${balanceSol.toFixed(4)} SOL` : '— SOL'}
                </Text>
              </View>
              <SecondaryButton
                label="Refresh"
                compact
                icon={<RefreshCw size={13} color={colors.ink} strokeWidth={2} />}
                onPress={onRefresh}
              />
            </View>
          </View>

          {/* 2. Tier & Seeker Hardware Verification Card */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <View style={s.rowBetween}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Smartphone
                  size={18}
                  color={isSeekerVerified ? colors.open : colors.ink2}
                  strokeWidth={2}
                />
                <Text style={[TYPE.title, { color: colors.ink }]}>
                  Tier {tier} · {bondMult}× Pool Cap
                </Text>
              </View>
              <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3 }]}>
                Max fee {maxFeePct}%
              </Text>
            </View>

            <Text style={[TYPE.caption, { color: colors.ink2 }]}>
              {isSeekerVerified
                ? 'Seeker hardware verified. Settle 3+ net-positive calls with zero slashes to advance through Tiers 1–3 (5× to 20× pool cap).'
                : 'Unverified wallets stay capped at Tier 0 (2× bond cap, 5% max fee). Verify with Seeker to bind one permanent track record per device.'}
            </Text>

            {!isSeekerVerified && (
              <PrimaryButton
                label={verifyingSgt ? 'Verifying with Seeker…' : 'Verify with Seeker'}
                loading={verifyingSgt}
                disabled={busy}
                icon={<ShieldCheck size={17} color="#FFFFFF" strokeWidth={2} />}
                onPress={onVerifySeeker}
              />
            )}
          </View>

          {/* 3. Personal Track Record (Honest Wins + Losses) */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <View style={s.rowBetween}>
              <Text style={[TYPE.title, { color: colors.ink }]}>Caller Track Record</Text>
              <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '500' }]}>
                Losses shown honestly
              </Text>
            </View>

            <View style={s.statsGrid}>
              <View style={[s.statBox, { backgroundColor: colors.subtle }]}>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Settled</Text>
                <Text style={[TYPE.title, TYPE.num, { color: colors.ink }]}>{settledCount}</Text>
              </View>
              <View style={[s.statBox, { backgroundColor: colors.subtle }]}>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Win rate</Text>
                <Text style={[TYPE.title, TYPE.num, { color: colors.ink }]}>
                  {winRatePct !== null ? `${winRatePct}%` : '—'}
                </Text>
              </View>
              <View style={[s.statBox, { backgroundColor: colors.subtle }]}>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Avg result</Text>
                {myCallerRecord?.avgNetBps !== null && myCallerRecord?.avgNetBps !== undefined ? (
                  <PnLText bps={myCallerRecord.avgNetBps} size="md" />
                ) : (
                  <Text style={[TYPE.title, { color: colors.ink3 }]}>—</Text>
                )}
              </View>
              <View style={[s.statBox, { backgroundColor: colors.subtle }]}>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Losses</Text>
                <Text
                  style={[
                    TYPE.title,
                    TYPE.num,
                    { color: lossesCount > 0 ? colors.loss : colors.ink },
                  ]}
                >
                  {lossesCount}
                </Text>
              </View>
            </View>
          </View>

          {/* 4. Ready to Claim Positions */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <Text style={[TYPE.title, { color: colors.ink }]}>
              Ready to Claim ({myClaimable.length})
            </Text>
            {myClaimable.length === 0 ? (
              <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                Settled or refunded pool payouts will appear here for one-tap SOL withdrawal.
              </Text>
            ) : (
              myClaimable.map(({ call, pos }) => (
                <View
                  key={call.callId}
                  style={[
                    s.positionRow,
                    { backgroundColor: colors.subtle, borderColor: colors.line },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[TYPE.bodySemi, { color: colors.ink }]}>
                      ${call.token.symbol} · Call #{call.callId}
                    </Text>
                    <Text style={[TYPE.caption, TYPE.num, { color: colors.gainText }]}>
                      {formatSolFloor(pos.claimableAmount, 4)} SOL claimable
                      {call.state === 'Settled' && call.netReturnBps !== null
                        ? ` (${formatSignedPct(call.netReturnBps)})`
                        : ''}
                    </Text>
                  </View>
                  <PrimaryButton
                    label="Claim SOL"
                    compact
                    disabled={busy}
                    onPress={() => onClaimPosition(call)}
                  />
                </View>
              ))
            )}
          </View>

          {/* 5. My Open & Holding Pools */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <Text style={[TYPE.title, { color: colors.ink }]}>
              My Active Pools ({myOpenPools.length})
            </Text>
            {myOpenPools.length === 0 ? (
              <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                You have no active Open or Holding positions right now.
              </Text>
            ) : (
              myOpenPools.map((call) => {
                const myPos = call.positions.find((p) => p.participant === session.pubkey);
                return (
                  <Pressable
                    key={call.callId}
                    onPress={() => onOpenCall(call)}
                    style={[
                      s.positionRow,
                      { backgroundColor: colors.subtle, borderColor: colors.line },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[TYPE.bodySemi, { color: colors.ink }]}>
                          ${call.token.symbol} · Call #{call.callId}
                        </Text>
                        <StatusPill
                          state={call.state}
                          windowEnd={call.rules.windowEnd}
                          nowSec={nowSec}
                          compact
                        />
                      </View>
                      <Text style={[TYPE.caption, TYPE.num, { color: colors.ink3 }]}>
                        {call.caller === session.pubkey ? 'Caller · ' : 'Follower · '}
                        {formatSolFloor(myPos?.depositedLamports ?? call.callerStakeLamports, 3)}{' '}
                        SOL locked
                      </Text>
                    </View>
                    <ChevronRight size={18} color={colors.ink3} strokeWidth={2} />
                  </Pressable>
                );
              })
            )}
          </View>
        </>
      )}

      {/* Appearance (Light / Dark / System) & Devnet Tools */}
      <View
        style={[
          s.card,
          SHADOWS.card,
          { backgroundColor: colors.surface, borderColor: colors.line },
        ]}
      >
        <Text style={[TYPE.title, { color: colors.ink }]}>Appearance</Text>
        <View style={[s.themeRow, { backgroundColor: colors.subtle, borderColor: colors.line }]}>
          {(
            [
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Smartphone],
            ] as const
          ).map(([val, label, Icon]) => {
            const active = mode === val;
            return (
              <Pressable
                key={val}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMode(val as ThemeMode);
                }}
                style={[
                  s.themeOption,
                  active && { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderWidth: 1 },
                ]}
              >
                <Icon size={14} color={active ? colors.accent : colors.ink3} strokeWidth={2} />
                <Text
                  style={[
                    TYPE.captionSemi,
                    { color: active ? colors.ink : colors.ink3, fontSize: 12 },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {session && (
          <View style={s.footerActions}>
            <SecondaryButton
              label={funding ? 'Requesting SOL…' : 'Get Devnet Test SOL'}
              compact
              loading={funding}
              icon={<Coins size={15} color={colors.ink} strokeWidth={2} />}
              onPress={onClaimFaucet}
              style={{ flex: 1 }}
            />
            <SecondaryButton
              label="Disconnect"
              compact
              icon={<LogOut size={15} color={colors.loss} strokeWidth={2} />}
              onPress={onDisconnect}
            />
          </View>
        )}
      </View>

      {/* Technical On-Chain Details Sheet (keeps PDA/Token-2022 terms out of primary view) */}
      {session && (
        <BottomSheet
          visible={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="On-Chain Account Details"
          subtitle="Solana Devnet verification metadata"
        >
          <View
            style={[
              s.detailList,
              { backgroundColor: colors.subtle, borderColor: colors.line },
            ]}
          >
            <Text style={[TYPE.micro, { color: colors.ink3 }]}>Wallet Address</Text>
            <Text selectable style={[TYPE.caption, TYPE.num, { color: colors.ink }]}>
              {session.pubkey}
            </Text>

            <Text style={[TYPE.micro, { color: colors.ink3, marginTop: SPACING.sm }]}>
              Caller Bond Locked
            </Text>
            <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
              {formatSolFloor(myCallerRecord?.bondLamports ?? '0', 4)} SOL (slashable on
              negligence)
            </Text>

            <Text style={[TYPE.micro, { color: colors.ink3, marginTop: SPACING.sm }]}>
              Seeker Genesis Binding
            </Text>
            <Text selectable style={[TYPE.caption, TYPE.num, { color: colors.ink }]}>
              {myCallerRecord?.genesisMint ??
                localSgtMint ??
                'Not bound yet (Token-2022 NonTransferable mint -> GenesisRegistry PDA)'}
            </Text>
          </View>
          <SecondaryButton label="Close" onPress={() => setDetailsOpen(false)} />
        </BottomSheet>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  pitchIconWrap: {
    width: 48,
    height: 48,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletList: {
    gap: SPACING.sm + 2,
    marginVertical: SPACING.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  iconPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
  },
  balanceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  statBox: {
    flex: 1,
    minWidth: '46%',
    padding: SPACING.md,
    borderRadius: RADII.md,
    gap: 4,
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  themeRow: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 4,
  },
  themeOption: {
    flex: 1,
    minHeight: 38,
    borderRadius: RADII.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  detailList: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 4,
  },
});
