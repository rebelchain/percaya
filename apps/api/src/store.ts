import { EventEmitter } from 'node:events';
import {
  DEMO_ALERTS,
  DEMO_CALLERS,
  DEMO_CALLS,
  DEMO_PROTOCOL_PARAMS,
  DEMO_TOKENS,
  type AlertItem,
  type CallDetail,
  type CallState,
  type CallSummary,
  type CallerRecord,
  type ProtocolParams,
  type ThreadReply,
  type TokenInfo,
} from '@percaya/core';

export interface PercayaStore {
  mode: 'demo' | 'chain';
  getConfig(): { params: ProtocolParams; tokens: TokenInfo[] };
  listCalls(filter?: { state?: CallState; tokenSymbol?: string; caller?: string }): CallSummary[];
  getCall(callId: number): CallDetail | null;
  listReplies(callId: number): ThreadReply[];
  addReply(callId: number, authorPubkey: string, body: string): ThreadReply | null;
  listCallers(): CallerRecord[];
  getCaller(pubkeyOrSkr: string): CallerRecord | null;
  listAlerts(pubkey?: string): AlertItem[];
  toggleFollow(follower: string, caller: string): { following: boolean };
  toggleWatch(watcher: string, callId: number): { watching: boolean };
  getSubscriptions(pubkey: string): { following: string[]; watching: number[] };
  emitAlert(alert: AlertItem): void;
  onAlert(listener: (alert: AlertItem) => void): () => void;
}

export function createPercayaStore(mode: 'demo' | 'chain' = 'demo'): PercayaStore {
  const calls = new Map<number, CallDetail>(
    structuredClone(DEMO_CALLS).map((c) => [c.callId, c]),
  );
  const callers = new Map<string, CallerRecord>(
    structuredClone(DEMO_CALLERS).map((c) => [c.pubkey, c]),
  );
  const alerts: AlertItem[] = structuredClone(DEMO_ALERTS);
  const followsByUser = new Map<string, Set<string>>();
  const watchesByUser = new Map<string, Set<number>>();
  const bus = new EventEmitter();

  return {
    mode,
    getConfig() {
      return {
        params: DEMO_PROTOCOL_PARAMS,
        tokens: DEMO_TOKENS,
      };
    },
    listCalls(filter) {
      let list = Array.from(calls.values());
      if (filter?.state) {
        list = list.filter((c) => c.state === filter.state);
      }
      if (filter?.tokenSymbol) {
        list = list.filter(
          (c) => c.token.symbol.toLowerCase() === filter.tokenSymbol!.toLowerCase(),
        );
      }
      if (filter?.caller) {
        list = list.filter(
          (c) => c.caller === filter.caller || c.callerSkr === filter.caller,
        );
      }
      // Strictly newest-first, never ranked (per design.md rule #2)
      list.sort((a, b) => b.callId - a.callId);
      return list.map(
        ({ positions, earlyBuyers, priceSeries, replies, buyTxSig, sellTxSig, ...summary }) => {
          void positions;
          void earlyBuyers;
          void priceSeries;
          void replies;
          void buyTxSig;
          void sellTxSig;
          return summary;
        },
      );
    },
    getCall(callId) {
      return calls.get(callId) ?? null;
    },
    listReplies(callId) {
      const call = calls.get(callId);
      return call ? [...call.replies].sort((a, b) => a.createdAt - b.createdAt) : [];
    },
    addReply(callId, authorPubkey, body) {
      const call = calls.get(callId);
      if (!call) return null;
      const trimmed = body.trim().slice(0, 280);
      if (!trimmed) return null;
      const pos = call.positions.find((p) => p.participant === authorPubkey);
      const callerInfo = callers.get(authorPubkey);
      const reply: ThreadReply = {
        id: `rep-${callId}-${Date.now()}`,
        callId,
        author: authorPubkey,
        authorSkr: callerInfo?.skrName ?? pos?.skrName ?? null,
        authorSeekerVerified: callerInfo?.isSeekerVerified ?? false,
        depositedLamports: pos?.depositedLamports ?? '0',
        isCaller: call.caller === authorPubkey,
        body: trimmed,
        createdAt: Math.floor(Date.now() / 1000),
      };
      call.replies.push(reply);
      return reply;
    },
    listCallers() {
      const list = Array.from(callers.values());
      // Ordered strictly by lastActive (per design.md)
      list.sort((a, b) => b.lastActive - a.lastActive);
      return list;
    },
    getCaller(pubkeyOrSkr) {
      const direct = callers.get(pubkeyOrSkr);
      if (direct) return direct;
      const needle = pubkeyOrSkr.toLowerCase();
      for (const c of callers.values()) {
        if (c.skrName?.toLowerCase() === needle) return c;
      }
      return null;
    },
    listAlerts() {
      return [...alerts].sort((a, b) => b.createdAt - a.createdAt);
    },
    toggleFollow(follower, caller) {
      const set = followsByUser.get(follower) ?? new Set<string>();
      followsByUser.set(follower, set);
      if (set.has(caller)) {
        set.delete(caller);
        return { following: false };
      }
      set.add(caller);
      return { following: true };
    },
    toggleWatch(watcher, callId) {
      const set = watchesByUser.get(watcher) ?? new Set<number>();
      watchesByUser.set(watcher, set);
      if (set.has(callId)) {
        set.delete(callId);
        return { watching: false };
      }
      set.add(callId);
      return { watching: true };
    },
    getSubscriptions(pubkey) {
      return {
        following: Array.from(followsByUser.get(pubkey) ?? []),
        watching: Array.from(watchesByUser.get(pubkey) ?? []),
      };
    },
    emitAlert(alert) {
      alerts.unshift(alert);
      bus.emit('alert', alert);
      void notifyTelegram(alert);
    },
    onAlert(listener) {
      bus.on('alert', listener);
      return () => {
        bus.off('alert', listener);
      };
    },
  };
}

async function notifyTelegram(alert: AlertItem): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const webUrl = process.env.PUBLIC_WEB_URL || 'https://percaya.app';
  const text = `${alert.title}\n${alert.body}\n\n${webUrl}/c/${alert.callId}`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    });
  } catch {
    // Non-fatal alert delivery failure
  }
}
