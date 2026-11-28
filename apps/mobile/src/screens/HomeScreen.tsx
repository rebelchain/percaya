import type { CallDetail, CallState } from '@percaya/core';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OnboardingStepId, OnboardingStepItem } from '../onboarding';
import { MIN_TOUCH_TARGET, RADII, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { CallCard } from '../components/CallCard';
import { JudgeChecklistCard } from '../components/OnboardingGuide';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Coins,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from '../components/ui/icons';
import {
  CallCardSkeleton,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui/primitives';

export type FeedMode = 'newest' | 'following';
export type HomeFilterTab = 'All' | 'Open' | 'Holding' | 'Settled';

export interface HomeScreenProps {
  calls: CallDetail[];
  nowSec: number;
  loadingInitial: boolean;
  refreshing: boolean;
  rpcOffline: boolean;
  feedMode: FeedMode;
  onChangeFeedMode: (mode: FeedMode) => void;
  stateFilter: HomeFilterTab;
  onChangeStateFilter: (st: HomeFilterTab) => void;
  tokenFilter: string;
  onClearTokenFilter: () => void;
  following: string[];
  watching: number[];
  viewerPubkey?: string | null;
  balanceSol: number | null;
  funding: boolean;
  busy: boolean;
  showChecklist: boolean;
  onboardingSteps: OnboardingStepItem[];
  onboardingCompletedCount: number;
  onChecklistAction: (stepId: OnboardingStepId) => void;
  onDismissChecklist: () => void;
  onClaimFaucet: () => void;
  onRefresh: () => void;
  onOpenCall: (call: CallDetail) => void;
  onOpenCaller: (pubkey: string) => void;
  onJoinCall: (call: CallDetail) => void;
  onExecuteBuy: (call: CallDetail) => void;
  onToggleWatch: (callId: number) => void;
  onShareCall: (call: CallDetail) => void;
  onCreateCall: () => void;
}

/**
 * Redesigned Home Feed (Phase 2):
 * - Sticky For You / Following + Segmented Status Filter with live counts
 * - Real working "Verified only" filter toggle (replacing static caption)
 * - Pinned "Live now" section (Open & Holding first)
 * - Collapsed "Past refunded pools (N)" accordion at the bottom
 */
export function HomeScreen({
  calls,
  nowSec,
  loadingInitial,
  refreshing,
  rpcOffline,
  feedMode,
  onChangeFeedMode,
  stateFilter,
  onChangeStateFilter,
  tokenFilter,
  onClearTokenFilter,
  following,
  watching,
  viewerPubkey,
  balanceSol,
  funding,
  busy,
  showChecklist,
  onboardingSteps,
  onboardingCompletedCount,
  onChecklistAction,
  onDismissChecklist,
  onClaimFaucet,
  onRefresh,
  onOpenCall,
  onOpenCaller,
  onJoinCall,
  onExecuteBuy,
  onToggleWatch,
  onShareCall,
  onCreateCall,
}: HomeScreenProps) {
  const { colors } = useTheme();
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [refundedExpanded, setRefundedExpanded] = useState(false);

  const baseFiltered = useMemo(() => {
    return calls.filter((c) => {
      if (feedMode === 'following' && !following.includes(c.caller)) return false;
      if (tokenFilter !== 'All' && c.token.symbol !== tokenFilter) return false;
      if (verifiedOnly && !c.callerSeekerVerified) return false;
      return true;
    });
  }, [calls, feedMode, following, tokenFilter, verifiedOnly]);

  const counts = useMemo(() => {
    const open = baseFiltered.filter((c) => c.state === 'Open').length;
    const holding = baseFiltered.filter((c) => c.state === 'Holding').length;
    const settled = baseFiltered.filter((c) => c.state === 'Settled').length;
    const activeTotal = open + holding + settled;
    return {
      All: activeTotal > 0 ? activeTotal : baseFiltered.length,
      Open: open,
      Holding: holding,
      Settled: settled,
    };
  }, [baseFiltered]);

  const { liveCalls, settledCalls, refundedCalls } = useMemo(() => {
    const matching = baseFiltered.filter((c) =>
      stateFilter === 'All' ? true : c.state === (stateFilter as CallState),
    );
    const live = matching
      .filter((c) => c.state === 'Open' || c.state === 'Holding')
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'Open' ? -1 : 1;
        return b.openedAt - a.openedAt;
      });
    const settled = matching
      .filter((c) => c.state === 'Settled' || c.state === 'Split')
      .sort((a, b) => b.openedAt - a.openedAt);
    const refunded =
      stateFilter === 'All'
        ? baseFiltered
            .filter((c) => c.state === 'Refunded')
            .sort((a, b) => b.openedAt - a.openedAt)
        : [];
    return { liveCalls: live, settledCalls: settled, refundedCalls: refunded };
  }, [baseFiltered, stateFilter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top Feed Mode Tabs (For you / Following) */}
      <View style={[s.modeTabs, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
        {(['newest', 'following'] as const).map((m) => {
          const active = feedMode === m;
          return (
            <Pressable
              key={m}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onChangeFeedMode(m);
              }}
              style={[
                s.modeTabBtn,
                active && { borderBottomWidth: 2, borderBottomColor: colors.ink },
              ]}
            >
              <Text
                style={[
                  TYPE.captionSemi,
                  { color: active ? colors.ink : colors.ink3, fontWeight: active ? '700' : '500' },
                ]}
              >
                {m === 'newest' ? 'For you' : `Following (${following.length})`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Sticky Segmented Filter + Verified Toggle */}
      <View style={[s.stickyBar, { backgroundColor: colors.bg, borderBottomColor: colors.line }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterScroll}
        >
          <View style={[s.segTrack, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {(['All', 'Open', 'Holding', 'Settled'] as const).map((st) => {
              const active = stateFilter === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onChangeStateFilter(st);
                  }}
                  style={[
                    s.segBtn,
                    active && { backgroundColor: colors.openFill },
                  ]}
                >
                  <Text
                    style={[
                      TYPE.micro,
                      TYPE.num,
                      {
                        fontSize: 12,
                        color: active ? colors.openText : colors.ink2,
                        fontWeight: active ? '700' : '500',
                      },
                    ]}
                  >
                    {st} ({counts[st]})
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setVerifiedOnly((v) => !v);
            }}
            style={[
              s.verifiedToggle,
              {
                backgroundColor: verifiedOnly ? colors.openFill : colors.surface,
                borderColor: verifiedOnly ? colors.open : colors.line,
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: verifiedOnly }}
          >
            <ShieldCheck
              size={14}
              color={verifiedOnly ? colors.openText : colors.ink3}
              strokeWidth={2}
            />
            <Text
              style={[
                TYPE.micro,
                { fontSize: 12, color: verifiedOnly ? colors.openText : colors.ink2 },
              ]}
            >
              Verified
            </Text>
          </Pressable>

          {tokenFilter !== 'All' && (
            <Pressable
              onPress={onClearTokenFilter}
              style={[
                s.verifiedToggle,
                { backgroundColor: colors.accentFill, borderColor: colors.accent },
              ]}
            >
              <Text style={[TYPE.micro, { fontSize: 12, color: colors.accentDeep }]}>
                ${tokenFilter}
              </Text>
              <X size={13} color={colors.accentDeep} strokeWidth={2.2} />
            </Pressable>
          )}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={s.feedContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* RPC Offline / Retry Banner */}
        {rpcOffline && (
          <View
            style={[
              s.banner,
              { backgroundColor: colors.holdingFill, borderColor: colors.holding },
            ]}
          >
            <AlertCircle size={18} color={colors.holdingText} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.captionSemi, { color: colors.holdingText }]}>
                Solana Devnet RPC slow or unreachable
              </Text>
              <Text style={[TYPE.micro, { color: colors.holdingText, fontWeight: '400' }]}>
                Showing last synced pools. Pull down or tap Retry to reconnect.
              </Text>
            </View>
            <SecondaryButton
              label="Retry"
              compact
              icon={<RefreshCw size={13} color={colors.ink} strokeWidth={2} />}
              onPress={onRefresh}
            />
          </View>
        )}

        {/* Interactive Onboarding Checklist (dismissible) */}
        {showChecklist && (
          <JudgeChecklistCard
            steps={onboardingSteps}
            completedCount={onboardingCompletedCount}
            busy={busy || funding}
            onAction={onChecklistAction}
            onDismiss={onDismissChecklist}
          />
        )}

        {/* Low Devnet Balance Helper */}
        {viewerPubkey && balanceSol !== null && balanceSol < 0.06 && (
          <View
            style={[
              s.banner,
              { backgroundColor: colors.openFill, borderColor: colors.open },
            ]}
          >
            <Coins size={18} color={colors.openText} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.captionSemi, TYPE.num, { color: colors.openText }]}>
                Low Devnet balance ({balanceSol.toFixed(3)} SOL)
              </Text>
              <Text style={[TYPE.micro, { color: colors.openText, fontWeight: '400' }]}>
                Claim free Devnet SOL to join pools or lock a caller stake.
              </Text>
            </View>
            <PrimaryButton
              label={funding ? 'Funding…' : 'Get SOL'}
              compact
              loading={funding}
              onPress={onClaimFaucet}
            />
          </View>
        )}

        {loadingInitial ? (
          <View style={{ gap: SPACING.lg }}>
            <CallCardSkeleton />
            <CallCardSkeleton />
          </View>
        ) : liveCalls.length === 0 && settledCalls.length === 0 && refundedCalls.length === 0 ? (
          <EmptyState
            icon={<PlusCircle size={22} color={colors.accent} strokeWidth={2} />}
            title={
              feedMode === 'following'
                ? 'No calls from followed callers yet'
                : verifiedOnly
                  ? 'No verified calls match this filter'
                  : 'No calls match this filter'
            }
            body={
              feedMode === 'following'
                ? 'Follow callers in the Callers tab or switch back to For you to scan all live pools.'
                : 'Open the first pooled call with locked SOL rules, or reset your filter.'
            }
            actionLabel={feedMode === 'following' ? 'Browse For you' : 'Create a call'}
            onAction={() => (feedMode === 'following' ? onChangeFeedMode('newest') : onCreateCall())}
          />
        ) : (
          <>
            {/* Pinned "Live now" Section */}
            {liveCalls.length > 0 && (
              <View style={s.sectionBlock}>
                <View style={s.sectionHeader}>
                  <View style={[s.livePulseDot, { backgroundColor: colors.open }]} />
                  <Text style={[TYPE.captionSemi, { color: colors.ink }]}>
                    Live now ({liveCalls.length})
                  </Text>
                  <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                    · Active windows & open positions
                  </Text>
                </View>

                <View style={s.cardsStack}>
                  {liveCalls.map((call) => (
                    <CallCard
                      key={call.callId}
                      call={call}
                      nowSec={nowSec}
                      isWatching={watching.includes(call.callId)}
                      viewerPubkey={viewerPubkey}
                      busy={busy}
                      onPressCard={onOpenCall}
                      onPressCaller={onOpenCaller}
                      onPressJoin={onJoinCall}
                      onPressBuy={onExecuteBuy}
                      onToggleWatch={onToggleWatch}
                      onShare={onShareCall}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Settled Outcomes Section */}
            {settledCalls.length > 0 && (
              <View style={s.sectionBlock}>
                {liveCalls.length > 0 && (
                  <View style={s.sectionHeader}>
                    <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>
                      Settled outcomes ({settledCalls.length})
                    </Text>
                    <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                      · Permanent on-chain record
                    </Text>
                  </View>
                )}

                <View style={s.cardsStack}>
                  {settledCalls.map((call) => (
                    <CallCard
                      key={call.callId}
                      call={call}
                      nowSec={nowSec}
                      isWatching={watching.includes(call.callId)}
                      viewerPubkey={viewerPubkey}
                      busy={busy}
                      onPressCard={onOpenCall}
                      onPressCaller={onOpenCaller}
                      onPressJoin={onJoinCall}
                      onPressBuy={onExecuteBuy}
                      onToggleWatch={onToggleWatch}
                      onShare={onShareCall}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Collapsed Refunded Pools Accordion */}
            {refundedCalls.length > 0 && (
              <View style={s.sectionBlock}>
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRefundedExpanded((e) => !e);
                  }}
                  style={[
                    s.refundedToggle,
                    { backgroundColor: colors.surface, borderColor: colors.line },
                  ]}
                  accessibilityRole="button"
                >
                  <View>
                    <Text style={[TYPE.captionSemi, { color: colors.ink2 }]}>
                      Past refunded pools ({refundedCalls.length})
                    </Text>
                    <Text style={[TYPE.micro, { color: colors.ink3, fontWeight: '400' }]}>
                      Unfilled or expired windows — SOL returned 1:1
                    </Text>
                  </View>
                  {refundedExpanded ? (
                    <ChevronUp size={18} color={colors.ink3} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={18} color={colors.ink3} strokeWidth={2} />
                  )}
                </Pressable>

                {refundedExpanded && (
                  <View style={s.cardsStack}>
                    {refundedCalls.map((call) => (
                      <CallCard
                        key={call.callId}
                        call={call}
                        nowSec={nowSec}
                        isWatching={watching.includes(call.callId)}
                        viewerPubkey={viewerPubkey}
                        busy={busy}
                        onPressCard={onOpenCall}
                        onPressCaller={onOpenCaller}
                        onPressJoin={onJoinCall}
                        onPressBuy={onExecuteBuy}
                        onToggleWatch={onToggleWatch}
                        onShare={onShareCall}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  modeTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  modeTabBtn: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyBar: {
    borderBottomWidth: 1,
    paddingVertical: SPACING.sm,
  },
  filterScroll: {
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  segTrack: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  segBtn: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedToggle: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderRadius: RADII.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  feedContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  sectionBlock: {
    gap: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  cardsStack: {
    gap: SPACING.lg,
  },
  refundedToggle: {
    minHeight: MIN_TOUCH_TARGET + 8,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
