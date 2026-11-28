import type { CallDetail } from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  deriveActivityFeed,
  type ActivityActionKind,
  type ActivityTone,
  type DerivedActivityItem,
} from '../activity-feed';
import { formatTimeAgo } from '../theme/format';
import { RADII, SHADOWS, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import {
  Bell,
  Clock,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from '../components/ui/icons';
import {
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui/primitives';

export interface ActivityScreenProps {
  calls: CallDetail[];
  watching: number[];
  viewerPubkey?: string | null;
  nowSec: number;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenCall: (callId: number) => void;
  onAction: (kind: ActivityActionKind, call: CallDetail) => void;
  onBrowseHome: () => void;
}

export function ActivityScreen({
  calls,
  watching,
  viewerPubkey,
  nowSec,
  busy,
  refreshing,
  onRefresh,
  onOpenCall,
  onAction,
  onBrowseHome,
}: ActivityScreenProps) {
  const { colors } = useTheme();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [readIds, setReadIds] = useState<string[]>([]);

  const allItems = useMemo(
    () => deriveActivityFeed({ calls, watching, viewerPubkey, nowSec }),
    [calls, watching, viewerPubkey, nowSec],
  );

  const visibleItems = useMemo(
    () => (scope === 'mine' ? allItems.filter((i) => i.isMine) : allItems),
    [allItems, scope],
  );

  const todayItems = useMemo(
    () => visibleItems.filter((i) => i.bucket === 'today'),
    [visibleItems],
  );
  const earlierItems = useMemo(
    () => visibleItems.filter((i) => i.bucket === 'earlier'),
    [visibleItems],
  );

  const markRead = (id: string) => {
    setReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const toneVisual = (tone: ActivityTone) => {
    if (tone === 'gain') {
      return { bg: colors.gainFill, fg: colors.gainText, Icon: TrendingUp };
    }
    if (tone === 'loss') {
      return { bg: colors.lossFill, fg: colors.lossText, Icon: TrendingDown };
    }
    if (tone === 'holding') {
      return { bg: colors.holdingFill, fg: colors.holdingText, Icon: Clock };
    }
    if (tone === 'open') {
      return { bg: colors.openFill, fg: colors.openText, Icon: Zap };
    }
    return { bg: colors.refundedFill, fg: colors.refundedText, Icon: RefreshCw };
  };

  const renderItem = (item: DerivedActivityItem) => {
    const vis = toneVisual(item.tone);
    const unread = !readIds.includes(item.id) && item.bucket === 'today';
    const targetCall = calls.find((c) => c.callId === item.callId);
    const isPrimaryAction =
      item.actionKind === 'claim' || item.actionKind === 'buy' || item.actionKind === 'sell';

    return (
      <Pressable
        key={item.id}
        onPress={() => {
          markRead(item.id);
          onOpenCall(item.callId);
        }}
        style={[
          s.itemCard,
          SHADOWS.card,
          { backgroundColor: colors.surface, borderColor: colors.line },
        ]}
      >
        <View style={[s.iconCircle, { backgroundColor: vis.bg }]}>
          <vis.Icon size={18} color={vis.fg} strokeWidth={2.1} />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <View style={s.titleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              {unread && <View style={[s.unreadDot, { backgroundColor: colors.accent }]} />}
              <Text style={[TYPE.bodySemi, { color: colors.ink, flex: 1, fontSize: 14 }]}>
                {item.title}
              </Text>
            </View>
            <Text style={[TYPE.micro, TYPE.num, { color: colors.ink3, fontWeight: '500' }]}>
              {formatTimeAgo(item.timestamp, nowSec)}
            </Text>
          </View>

          <Text style={[TYPE.caption, { color: colors.ink2 }]}>{item.body}</Text>

          {targetCall && (
            <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              {isPrimaryAction ? (
                <PrimaryButton
                  label={item.actionLabel}
                  compact
                  disabled={busy}
                  onPress={() => {
                    markRead(item.id);
                    onAction(item.actionKind, targetCall);
                  }}
                />
              ) : (
                <SecondaryButton
                  label={item.actionLabel}
                  compact
                  disabled={busy && item.actionKind !== 'view'}
                  onPress={() => {
                    markRead(item.id);
                    onAction(item.actionKind, targetCall);
                  }}
                />
              )}
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  const mineCount = allItems.filter((i) => i.isMine).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Scope Filter Bar: All Pool Activity vs My Pools & Alerts */}
      <View style={[s.filterBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
        {(
          [
            ['all', `All pools (${allItems.length})`],
            ['mine', `My pools & alerts (${mineCount})`],
          ] as const
        ).map(([val, label]) => {
          const active = scope === val;
          return (
            <Pressable
              key={val}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setScope(val);
              }}
              style={[
                s.scopeTab,
                active && { borderBottomWidth: 2, borderBottomColor: colors.ink },
              ]}
            >
              <Text
                style={[
                  TYPE.captionSemi,
                  { color: active ? colors.ink : colors.ink3, fontWeight: active ? '700' : '500' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {visibleItems.length === 0 ? (
          <EmptyState
            icon={<Bell size={22} color={colors.accent} strokeWidth={2} />}
            title={scope === 'mine' ? 'No personal pool alerts yet' : 'No pool activity yet'}
            body={
              scope === 'mine'
                ? 'Tap Notify on any call card or join an open pool to track checkpoints, exits, and SOL claims here.'
                : 'Live pool buys, checkpoints, and settlements will appear here automatically.'
            }
            actionLabel="Explore live calls"
            onAction={onBrowseHome}
          />
        ) : (
          <>
            {todayItems.length > 0 && (
              <View style={s.groupSection}>
                <Text style={[TYPE.captionSemi, { color: colors.ink3, paddingHorizontal: 2 }]}>
                  Today
                </Text>
                {todayItems.map(renderItem)}
              </View>
            )}

            {earlierItems.length > 0 && (
              <View style={s.groupSection}>
                <Text style={[TYPE.captionSemi, { color: colors.ink3, paddingHorizontal: 2 }]}>
                  Earlier
                </Text>
                {earlierItems.map(renderItem)}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  filterBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  scopeTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  groupSection: {
    gap: SPACING.md,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
