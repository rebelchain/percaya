import {
  displayIdentity,
  formatSolFloor,
  type CallDetail,
  type CallerRecord,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { ArrowLeft, ShieldAlert, UserCheck, UserPlus } from './ui/icons';
import {
  Avatar,
  PnLText,
  StatusPill,
  TierBadge,
} from './ui/primitives';

export interface CallerDetailModalProps {
  caller: CallerRecord | null;
  calls: CallDetail[];
  isFollowing: boolean;
  nowSec: number;
  onClose: () => void;
  onToggleFollow: (pubkey: string) => void;
  onSelectCall: (callId: number) => void;
}

export function CallerDetailModal({
  caller,
  calls,
  isFollowing,
  nowSec,
  onClose,
  onToggleFollow,
  onSelectCall,
}: CallerDetailModalProps) {
  const { colors } = useTheme();
  const [subTab, setSubTab] = useState<'calls' | 'record' | 'slashes'>('calls');

  if (!caller) return null;

  const callerCalls = calls.filter((c) => c.caller === caller.pubkey);
  const wins = Math.max(0, caller.settled - caller.losses);
  const winRate = caller.settled > 0 ? `${Math.round((wins / caller.settled) * 100)}%` : '—';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={[s.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
          <Pressable
            onPress={onClose}
            style={s.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={20} color={colors.ink} strokeWidth={2} />
            <Text style={[TYPE.bodySemi, { color: colors.ink }]}>Caller</Text>
          </Pressable>

          <Pressable
            onPress={() => onToggleFollow(caller.pubkey)}
            style={[
              s.followBtn,
              isFollowing
                ? { backgroundColor: colors.openFill, borderColor: 'transparent' }
                : { backgroundColor: colors.surface, borderColor: colors.lineStrong },
            ]}
          >
            {isFollowing ? (
              <UserCheck size={14} color={colors.openText} strokeWidth={2} />
            ) : (
              <UserPlus size={14} color={colors.ink} strokeWidth={2} />
            )}
            <Text
              style={[
                TYPE.captionSemi,
                { fontSize: 12, color: isFollowing ? colors.openText : colors.ink },
              ]}
            >
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.content}>
          {/* Identity Summary */}
          <View
            style={[
              s.card,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <View style={s.identityRow}>
              <Avatar seed={caller.pubkey} size={52} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[TYPE.title, { color: colors.ink }]}>
                  {displayIdentity(caller.pubkey, caller.skrName)}
                </Text>
                <TierBadge
                  verified={caller.isSeekerVerified}
                  tier={caller.tierInfo.tier}
                />
              </View>
            </View>

            <Text style={[TYPE.caption, { color: colors.ink2 }]}>
              {caller.tierInfo.reason}
            </Text>

            <View
              style={[
                s.bondStrip,
                { backgroundColor: colors.subtle, borderColor: colors.line },
              ]}
            >
              <View>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Active Bond</Text>
                <Text style={[TYPE.bodySemi, TYPE.num, { color: colors.ink }]}>
                  {formatSolFloor(caller.bondLamports, 3)} SOL
                </Text>
              </View>
              <View>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Pool Cap</Text>
                <Text style={[TYPE.bodySemi, TYPE.num, { color: colors.ink }]}>
                  {caller.tierInfo.bondMultiple}× bond
                </Text>
              </View>
              <View>
                <Text style={[TYPE.micro, { color: colors.ink3 }]}>Avg Return</Text>
                {caller.settled > 0 ? (
                  <PnLText bps={caller.avgNetBps} size="sm" />
                ) : (
                  <Text style={[TYPE.captionSemi, { color: colors.ink3 }]}>No settled</Text>
                )}
              </View>
            </View>
          </View>

          {/* Sub-navigation Tabs */}
          <View style={[s.subTabs, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {(
              [
                ['calls', `Calls (${callerCalls.length})`],
                ['record', 'Full Record'],
                ['slashes', `Slashes (${caller.slashes})`],
              ] as const
            ).map(([k, label]) => {
              const active = subTab === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSubTab(k);
                  }}
                  style={[
                    s.subTabBtn,
                    active && { backgroundColor: colors.openFill },
                  ]}
                >
                  <Text
                    style={[
                      TYPE.captionSemi,
                      { fontSize: 12, color: active ? colors.openText : colors.ink3 },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {subTab === 'calls' &&
            (callerCalls.length === 0 ? (
              <View
                style={[
                  s.card,
                  { backgroundColor: colors.surface, borderColor: colors.line },
                ]}
              >
                <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                  No calls indexed in current window.
                </Text>
              </View>
            ) : (
              callerCalls.map((c) => (
                <Pressable
                  key={c.callId}
                  onPress={() => {
                    onClose();
                    onSelectCall(c.callId);
                  }}
                  style={[
                    s.card,
                    SHADOWS.card,
                    { backgroundColor: colors.surface, borderColor: colors.line },
                  ]}
                >
                  <View style={s.rowBetween}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[TYPE.bodySemi, { color: colors.ink }]}>
                        ${c.token.symbol} · Call #{c.callId}
                      </Text>
                      <StatusPill
                        state={c.state}
                        netReturnBps={c.netReturnBps}
                        windowEnd={c.rules.windowEnd}
                        nowSec={nowSec}
                        compact
                      />
                    </View>
                    {c.state === 'Settled' && <PnLText bps={c.netReturnBps} size="sm" />}
                  </View>
                  <Text numberOfLines={2} style={[TYPE.caption, { color: colors.ink2 }]}>
                    {c.thesis}
                  </Text>
                </Pressable>
              ))
            ))}

          {subTab === 'record' && (
            <View
              style={[
                s.card,
                SHADOWS.card,
                { backgroundColor: colors.surface, borderColor: colors.line },
              ]}
            >
              <View style={s.recordGrid}>
                <View style={[s.recordCell, { backgroundColor: colors.subtle }]}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>Settled Calls</Text>
                  <Text style={[TYPE.title, TYPE.num, { color: colors.ink }]}>
                    {caller.settled}
                  </Text>
                </View>
                <View style={[s.recordCell, { backgroundColor: colors.subtle }]}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>Win Rate</Text>
                  <Text style={[TYPE.title, TYPE.num, { color: colors.ink }]}>{winRate}</Text>
                </View>
                <View style={[s.recordCell, { backgroundColor: colors.subtle }]}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>Losses</Text>
                  <Text
                    style={[
                      TYPE.title,
                      TYPE.num,
                      { color: caller.losses > 0 ? colors.loss : colors.ink },
                    ]}
                  >
                    {caller.losses}
                  </Text>
                </View>
                <View style={[s.recordCell, { backgroundColor: colors.subtle }]}>
                  <Text style={[TYPE.micro, { color: colors.ink3 }]}>Refunded Pools</Text>
                  <Text style={[TYPE.title, TYPE.num, { color: colors.ink }]}>
                    {caller.refunded}
                  </Text>
                </View>
              </View>
              <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                Outcomes cannot be deleted or hidden. Every settled call—including stop-loss exits—is
                permanently tallied in CallerRecord on Solana.
              </Text>
            </View>
          )}

          {subTab === 'slashes' &&
            (caller.slashHistory.length === 0 && caller.slashes === 0 ? (
              <View
                style={[
                  s.card,
                  { backgroundColor: colors.surface, borderColor: colors.line },
                ]}
              >
                <Text style={[TYPE.captionSemi, { color: colors.gainText }]}>
                  Zero bond slashes on record
                </Text>
                <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                  Caller bonds are only slashed on proven protocol negligence or early-dump
                  violations, never for normal market stop-losses.
                </Text>
              </View>
            ) : (
              caller.slashHistory.map((sl) => (
                <View
                  key={sl.txSig}
                  style={[
                    s.card,
                    { backgroundColor: colors.lossFill, borderColor: colors.loss },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert size={18} color={colors.lossText} strokeWidth={2} />
                    <Text style={[TYPE.bodySemi, TYPE.num, { color: colors.lossText }]}>
                      Slashed {formatSolFloor(sl.amountLamports, 3)} SOL
                    </Text>
                  </View>
                  <Text style={[TYPE.caption, { color: colors.lossText }]}>{sl.reason}</Text>
                </View>
              ))
            ))}
        </ScrollView>
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
    paddingRight: SPACING.md,
  },
  followBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  bondStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  subTabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 4,
  },
  subTabBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  recordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  recordCell: {
    flex: 1,
    minWidth: '46%',
    padding: SPACING.md,
    borderRadius: RADII.md,
    gap: 4,
  },
});
