import {
  displayIdentity,
  type CallDetail,
  type CallerRecord,
  type TokenInfo,
} from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { formatTimeAgo } from '../theme/format';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { UserCheck, UserPlus, Users } from '../components/ui/icons';
import {
  Avatar,
  EmptyState,
  PnLText,
  TierBadge,
} from '../components/ui/primitives';

export interface CallersScreenProps {
  callers: CallerRecord[];
  calls: CallDetail[];
  tokens: TokenInfo[];
  following: string[];
  nowSec: number;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleFollow: (pubkey: string) => void;
  onSelectCaller: (caller: CallerRecord) => void;
}

function CallerMiniSparkBars({
  settledCalls,
}: {
  settledCalls: CallDetail[];
}) {
  const { colors } = useTheme();
  const recent = settledCalls.slice(0, 8).reverse();
  if (recent.length === 0) return null;

  const width = recent.length * 8;
  return (
    <Svg width={width} height={22} viewBox={`0 0 ${width} 22`}>
      <Line x1="0" y1="11" x2={width} y2="11" stroke={colors.lineStrong} strokeWidth="1" />
      {recent.map((c, idx) => {
        const bps = c.netReturnBps ?? 0;
        const mag = Math.min(9, Math.max(2, Math.round(Math.abs(bps) / 400)));
        const isPos = bps >= 0;
        return (
          <Rect
            key={c.callId}
            x={idx * 8 + 1}
            y={isPos ? 11 - mag : 11}
            width={5}
            height={mag}
            rx={1.5}
            fill={isPos ? colors.gain : colors.loss}
          />
        );
      })}
    </Svg>
  );
}

/**
 * Redesigned Callers Directory (Phase 6):
 * - Compact sticky horizontal token chip row
 * - Explicit principle: "Sorted by recent activity, no leaderboards."
 * - Friendly "No settled calls yet" when settled === 0
 * - Outline Follow / tonal Following buttons (zero heavy black pills)
 */
export function CallersScreen({
  callers,
  calls,
  tokens,
  following,
  nowSec,
  refreshing,
  onRefresh,
  onToggleFollow,
  onSelectCaller,
}: CallersScreenProps) {
  const { colors } = useTheme();
  const [selectedToken, setSelectedToken] = useState<string>('All');

  const filteredCallers = useMemo(() => {
    const sorted = [...callers].sort((a, b) => b.lastActive - a.lastActive);
    if (selectedToken === 'All') return sorted;
    return sorted.filter((caller) =>
      calls.some((call) => call.caller === caller.pubkey && call.token.symbol === selectedToken),
    );
  }, [callers, calls, selectedToken]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Sticky Token Filter Row */}
      <View style={[s.stickyBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScroll}
        >
          {['All', ...tokens.map((t) => t.symbol)].map((sym) => {
            const active = selectedToken === sym;
            return (
              <Pressable
                key={sym}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedToken(sym);
                }}
                style={[
                  s.tokenChip,
                  {
                    backgroundColor: active ? colors.openFill : colors.subtle,
                    borderColor: active ? colors.open : colors.line,
                  },
                ]}
              >
                <Text
                  style={[
                    TYPE.micro,
                    {
                      fontSize: 12,
                      color: active ? colors.openText : colors.ink2,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {sym === 'All' ? 'All tokens' : `$${sym}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <View style={s.principleHeader}>
          <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
            Callers ({filteredCallers.length})
          </Text>
          <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '500' }]}>
            Sorted by recent activity, no leaderboards.
          </Text>
        </View>

        {filteredCallers.length === 0 ? (
          <EmptyState
            icon={<Users size={22} color={colors.accent} strokeWidth={2} />}
            title={`No callers for $${selectedToken} yet`}
            body="Reset the token filter to inspect all registered on-chain callers."
            actionLabel="Show all callers"
            onAction={() => setSelectedToken('All')}
          />
        ) : (
          filteredCallers.map((caller) => {
            const isFollowing = following.includes(caller.pubkey);
            const callerCalls = calls.filter((c) => c.caller === caller.pubkey);
            const settledCalls = callerCalls.filter((c) => c.state === 'Settled');
            const openCount = callerCalls.filter(
              (c) => c.state === 'Open' || c.state === 'Holding',
            ).length;
            const wins = Math.max(0, caller.settled - caller.losses);
            const winRate =
              caller.settled > 0 ? Math.round((wins / caller.settled) * 100) : null;

            return (
              <Pressable
                key={caller.pubkey}
                onPress={() => onSelectCaller(caller)}
                style={[
                  s.callerCard,
                  SHADOWS.card,
                  { backgroundColor: colors.surface, borderColor: colors.line },
                ]}
              >
                <View style={s.topRow}>
                  <View style={s.leftIdentity}>
                    <Avatar seed={caller.pubkey} size={42} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={s.nameRow}>
                        <Text
                          numberOfLines={1}
                          style={[TYPE.bodySemi, { color: colors.ink, flexShrink: 1 }]}
                        >
                          {displayIdentity(caller.pubkey, caller.skrName)}
                        </Text>
                        <TierBadge
                          verified={caller.isSeekerVerified}
                          tier={caller.tierInfo.tier}
                        />
                      </View>
                      <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontWeight: '500' }]}>
                        {caller.lastActive > 0
                          ? `Active ${formatTimeAgo(caller.lastActive, nowSec)} ago`
                          : 'Registered caller'}
                        {openCount > 0 ? ` · ${openCount} live` : ''}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => onToggleFollow(caller.pubkey)}
                    style={[
                      s.followBtn,
                      isFollowing
                        ? { backgroundColor: colors.openFill, borderColor: 'transparent' }
                        : { backgroundColor: colors.surface, borderColor: colors.lineStrong },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={isFollowing ? 'Unfollow caller' : 'Follow caller'}
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

                <View
                  style={[
                    s.metricsRow,
                    { backgroundColor: colors.subtle, borderColor: colors.line },
                  ]}
                >
                  {caller.settled === 0 ? (
                    <Text style={[TYPE.caption, { color: colors.ink3 }]}>
                      No settled calls yet
                      {callerCalls.length > 0
                        ? ` · ${callerCalls.length} call${callerCalls.length === 1 ? '' : 's'} opened`
                        : ''}
                    </Text>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
                        <View>
                          <Text style={[TYPE.micro, { color: colors.ink3 }]}>Record</Text>
                          <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.ink }]}>
                            {wins}W – {caller.losses}L ({winRate}%)
                          </Text>
                        </View>
                        <View>
                          <Text style={[TYPE.micro, { color: colors.ink3 }]}>Avg result</Text>
                          <PnLText bps={caller.avgNetBps} size="sm" />
                        </View>
                      </View>

                      <CallerMiniSparkBars settledCalls={settledCalls} />
                    </>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  stickyBar: {
    borderBottomWidth: 1,
    paddingVertical: SPACING.sm,
  },
  chipScroll: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenChip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  principleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  callerCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  leftIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  followBtn: {
    minHeight: MIN_TOUCH_TARGET - 6,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
});
