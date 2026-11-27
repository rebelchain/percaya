import {
  DEMO_CALLERS,
  DEMO_CALLS,
  DEMO_PROTOCOL_PARAMS,
  DEMO_TOKENS,
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  type CallDetail,
  type CallState,
  type CallSummary,
  type ProtocolParams,
} from '@percaya/core';
import { Check, Copy, ExternalLink, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

function VesselMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5C4 6.67 4.67 6 5.5 6H18.5C19.33 6 20 6.67 20 7.5V12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12V7.5Z"
        stroke="#0F1D24"
        strokeWidth="1.8"
      />
      <line x1="5.5" y1="12.5" x2="18.5" y2="12.5" stroke="#1F6E9C" strokeWidth="2.2" />
    </svg>
  );
}

function StatePill({ state }: { state: CallState }) {
  const styles: Record<CallState, string> = {
    Open: 'bg-accent text-white',
    Holding: 'bg-ink text-white',
    Settled: 'bg-subtle text-ink-2 border border-line',
    Refunded: 'bg-subtle text-ink-3 border border-line',
    Split: 'bg-subtle text-ink-2 border border-line',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[state]}`}>
      {state}
    </span>
  );
}

export function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname);
  const [calls, setCalls] = useState<CallSummary[]>(DEMO_CALLS);
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);
  const [params, setParams] = useState<ProtocolParams>(DEMO_PROTOCOL_PARAMS);
  const [apiMode, setApiMode] = useState<'demo' | 'chain' | 'offline'>('offline');
  const [programIds, setProgramIds] = useState<{ percayaProgramId: string; ammProgramId: string }>({
    percayaProgramId: '8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6',
    ammProgramId: 'AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz',
  });
  const [stateFilter, setStateFilter] = useState<CallState | 'All'>('All');
  const [tokenFilter, setTokenFilter] = useState<string>('All');
  const [copiedBlink, setCopiedBlink] = useState(false);

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (h?.mode) setApiMode(h.mode === 'chain' ? 'chain' : 'demo');
        if (h?.programs) setProgramIds(h.programs);
      })
      .catch(() => setApiMode('offline'));

    fetch('/api/calls')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.calls && d.calls.length > 0) setCalls(d.calls);
      })
      .catch(() => {});

    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.params) setParams(d.params);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const match = /^\/c\/(\d+)$/.exec(path);
    if (!match) {
      setSelectedCall(null);
      return;
    }
    const id = Number(match[1]);
    const local = DEMO_CALLS.find((c) => c.callId === id) ?? null;
    setSelectedCall(local);
    fetch(`/api/calls/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.call) setSelectedCall(d.call);
      })
      .catch(() => {});
  }, [path]);

  const filteredCalls = useMemo(() => {
    return calls.filter((c) => {
      if (stateFilter !== 'All' && c.state !== stateFilter) return false;
      if (tokenFilter !== 'All' && c.token.symbol !== tokenFilter) return false;
      return true;
    });
  }, [calls, stateFilter, tokenFilter]);

  const copyBlinkUrl = (callId: number) => {
    const url = `${window.location.origin}/c/${callId}`;
    void navigator.clipboard.writeText(url);
    setCopiedBlink(true);
    setTimeout(() => setCopiedBlink(false), 1800);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 text-left"
          >
            <VesselMark />
            <span className="font-semibold text-lg tracking-tight text-ink">percaya</span>
            <span className="hidden sm:inline-block text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent-deep font-medium">
              {apiMode === 'chain'
                ? '● Solana Devnet Live'
                : apiMode === 'demo'
                  ? '● API Demo'
                  : 'Threads · Seeker'}
            </span>
          </button>

          <nav className="flex items-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => navigate('/')}
              className={`font-medium ${path === '/' ? 'text-accent' : 'text-ink-2 hover:text-ink'}`}
            >
              Calls
            </button>
            <button
              type="button"
              onClick={() => navigate('/docs')}
              className={`font-medium ${path === '/docs' ? 'text-accent' : 'text-ink-2 hover:text-ink'}`}
            >
              Rules & Limits
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6">
        {path === '/docs' ? (
          <DocsView params={params} programIds={programIds} />
        ) : path === '/privacy' ? (
          <PrivacyView onBack={() => navigate('/')} />
        ) : path === '/terms' ? (
          <TermsView onBack={() => navigate('/')} />
        ) : selectedCall ? (
          <CallDetailView
            call={selectedCall}
            onBack={() => navigate('/')}
            onCopyBlink={() => copyBlinkUrl(selectedCall.callId)}
            copiedBlink={copiedBlink}
          />
        ) : (
          <>
            {/* Solid Brand Blue Anchor Banner (1 per screen per design.md) */}
            <section className="rounded-card bg-accent text-white p-5 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-white/80 font-medium">
                  Pooled Calls on Solana Mobile
                </p>
                <h1 className="text-xl font-semibold tracking-tight">
                  One buy. One sale. The same price for everyone.
                </h1>
                <p className="text-sm text-white/85">
                  Caller SOL rides inside the pool under immutable rules. Tiers 1–3 bind to a
                  1-per-device Seeker Genesis Token.
                </p>
              </div>
              <a
                href="percaya://calls"
                className="shrink-0 inline-flex items-center gap-2 bg-white text-ink px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-subtle transition"
              >
                <Smartphone className="w-4 h-4 text-accent" />
                Open Seeker App
              </a>
            </section>

            {/* Filter Strip */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 bg-surface p-1 rounded-xl border border-line">
                  {(['All', 'Open', 'Holding', 'Settled'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStateFilter(st)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        stateFilter === st
                          ? 'bg-accent-fill text-accent-deep'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-ink-3">Newest first · No ranking</span>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {['All', ...DEMO_TOKENS.map((t) => t.symbol)].map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setTokenFilter(sym)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      tokenFilter === sym
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface text-ink-2 border-line hover:border-line-strong'
                    }`}
                  >
                    {sym === 'All' ? 'All tokens' : `$${sym}`}
                  </button>
                ))}
              </div>
            </section>

            {/* Call Feed */}
            <section className="space-y-3">
              {filteredCalls.map((call) => (
                <CallRowCard
                  key={call.callId}
                  call={call}
                  onSelect={() => navigate(`/c/${call.callId}`)}
                />
              ))}
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-line bg-surface mt-12">
        <div className="max-w-3xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-ink-3">
          <span>percaya · Solana Devnet prototype · Unaudited hackathon experiment</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate('/privacy')} className="hover:text-ink">
              Privacy Policy
            </button>
            <span>·</span>
            <button type="button" onClick={() => navigate('/terms')} className="hover:text-ink">
              Terms of Use
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CallRowCard({ call, onSelect }: { call: CallSummary; onSelect: () => void }) {
  const callerName = displayIdentity(call.caller, call.callerSkr);
  const tp =
    call.rules.takeProfitBps > 0 ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%` : 'None';
  const sl = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;

  let primaryMetric: React.ReactNode;
  if (call.state === 'Settled') {
    const pos = (call.netReturnBps ?? 0) > 0;
    const neg = (call.netReturnBps ?? 0) < 0;
    primaryMetric = (
      <div className="text-right">
        <span
          className={`num text-lg font-semibold px-2.5 py-0.5 rounded-lg ${
            pos ? 'bg-gain-fill text-gain' : neg ? 'bg-loss-fill text-loss' : 'bg-subtle text-ink'
          }`}
        >
          {formatSignedPct(call.netReturnBps)}
        </span>
        <p className="text-[11px] text-ink-3 mt-1">net after fee</p>
      </div>
    );
  } else if (call.state === 'Holding') {
    primaryMetric = (
      <div className="text-right">
        <span className="num text-base font-semibold text-ink">
          {formatSignedPct(call.liveQuoteNetBps)}
        </span>
        <p className="text-[11px] text-ink-3 mt-0.5">indicative AMM quote</p>
      </div>
    );
  } else {
    primaryMetric = (
      <div className="text-right">
        <span className="num text-base font-semibold text-ink">
          {formatSolFloor(call.totalInLamports, 2)} / {formatSolFloor(call.liveCapLamports, 2)} SOL
        </span>
        <p className="text-[11px] text-ink-3 mt-0.5">{call.depositorsCount} in pool</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left bg-surface rounded-card border border-line hover:border-line-strong shadow-card p-4 space-y-3 transition"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm text-ink truncate">{callerName}</span>
          {call.callerSeekerVerified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-accent-soft text-accent-deep font-medium">
              <ShieldCheck className="w-3 h-3" />
              Seeker T{call.callerTier}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-subtle text-ink-3 border border-line">
              Unverified T0
            </span>
          )}
          <span className="num text-xs text-ink-3 hidden sm:inline">
            {call.callerSettled} settled · {call.callerLosses} losses
          </span>
        </div>
        <StatePill state={call.state} />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-ink">${call.token.symbol}</span>
            <span className="num text-xs text-ink-3">Call #{call.callId}</span>
          </div>
          <p className="text-sm text-ink-2 line-clamp-2">{call.thesis}</p>
        </div>
        <div className="shrink-0">{primaryMetric}</div>
      </div>

      <div className="bg-subtle rounded-xl px-3 py-2 border border-line flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <Lock className="w-3.5 h-3.5 text-ink-3" />
          Fixed at open
        </span>
        <span className="num">
          TP {tp} · SL {sl} · Max {Math.round(call.rules.maxHoldSec / 60)}m · Fee{' '}
          {(call.rules.shareBps / 100).toFixed(0)}%
        </span>
      </div>
    </button>
  );
}

function CallDetailView({
  call,
  onBack,
  onCopyBlink,
  copiedBlink,
}: {
  call: CallDetail;
  onBack: () => void;
  onCopyBlink: () => void;
  copiedBlink: boolean;
}) {
  const callerName = displayIdentity(call.caller, call.callerSkr);
  const tp =
    call.rules.takeProfitBps > 0 ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%` : 'None';
  const sl = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-ink-2 hover:text-ink">
        ← All calls
      </button>

      {/* Solid Accent Anchor Header */}
      <div className="rounded-card bg-accent text-white p-5 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/80">
            Call #{call.callId} · {call.state}
          </p>
          <h1 className="text-2xl font-semibold mt-0.5">
            ${call.token.symbol} pooled call by {callerName}
          </h1>
          <p className="text-sm text-white/85 mt-1">
            Caller stake locked: <span className="num">{formatSolFloor(call.callerStakeLamports, 4)} SOL</span>{' '}
            · Total pooled: <span className="num">{formatSolFloor(call.totalInLamports, 4)} SOL</span>
          </p>
        </div>

        {call.state === 'Settled' && (
          <div className="bg-white text-ink px-4 py-2.5 rounded-xl text-right">
            <div
              className={`num text-xl font-bold ${
                (call.netReturnBps ?? 0) >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {formatSignedPct(call.netReturnBps)}
            </div>
            <div className="text-[11px] text-ink-3">final net return</div>
          </div>
        )}
      </div>

      {/* Seeker App Deep-Link + Blink Actions */}
      <div className="bg-surface rounded-card border border-line p-4 shadow-card flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium text-ink">Sign via Seed Vault on Seeker</div>
          <div className="text-xs text-ink-3">
            Open directly inside the Android app or share as a Solana Action (Blink) in Telegram/X.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCopyBlink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line-strong bg-surface text-xs font-medium text-ink hover:bg-subtle"
          >
            {copiedBlink ? <Check className="w-3.5 h-3.5 text-gain" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedBlink ? 'Blink URL Copied' : 'Copy Blink Link'}
          </button>
          <a
            href={`percaya://c/${call.callId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ink text-white text-xs font-medium hover:bg-ink-2"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Open in Android App
          </a>
        </div>
      </div>

      {/* Thesis & Locked Rules */}
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-4">
        <div>
          <div className="text-xs font-medium text-ink-3 uppercase tracking-wider">Caller thesis</div>
          <p className="text-sm text-ink mt-1.5 leading-relaxed">{call.thesis}</p>
        </div>

        <div className="bg-subtle rounded-xl p-4 border border-line space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Lock className="w-3.5 h-3.5 text-accent" />
              Fixed at open · Immutable on Solana
            </span>
            <span className="num text-ink-3">Max 2.00% buy impact</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div>
              <div className="text-[11px] text-ink-3">Take-profit</div>
              <div className="num text-sm font-semibold text-ink">{tp}</div>
            </div>
            <div>
              <div className="text-[11px] text-ink-3">Stop-loss</div>
              <div className="num text-sm font-semibold text-ink">{sl}</div>
            </div>
            <div>
              <div className="text-[11px] text-ink-3">Max hold</div>
              <div className="num text-sm font-semibold text-ink">
                {Math.round(call.rules.maxHoldSec / 60)} min
              </div>
            </div>
            <div>
              <div className="text-[11px] text-ink-3">Profit-only fee</div>
              <div className="num text-sm font-semibold text-ink">
                {(call.rules.shareBps / 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Spaced Checkpoints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-ink-3">Checkpoint 1 (prev)</div>
            <div className="num text-sm font-semibold mt-0.5">
              {call.prevCheckpoint.at > 0
                ? `${formatSolFloor(call.prevCheckpoint.valueLamports, 4)} SOL`
                : 'Not recorded yet'}
            </div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-ink-3">
              Checkpoint 2 (last · ≥{call.rules.checkpointGapSec}s gap)
            </div>
            <div className="num text-sm font-semibold mt-0.5">
              {call.lastCheckpoint.at > 0
                ? `${formatSolFloor(call.lastCheckpoint.valueLamports, 4)} SOL`
                : 'Not recorded yet'}
            </div>
          </div>
        </div>
      </div>

      {/* Participants & Early Buyers */}
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Pool positions ({call.positions.length})
          </h2>
          <span className="text-xs text-ink-3">Same fill price for caller & joiners</span>
        </div>
        <div className="divide-y divide-line">
          {call.positions.map((pos) => (
            <div key={pos.participant} className="py-2.5 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">
                  {displayIdentity(pos.participant, pos.skrName)}
                </span>
                {pos.isCaller && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-subtle border border-line text-ink-2">
                    Caller (locked)
                  </span>
                )}
              </div>
              <div className="num text-right">
                <span className="font-medium">{formatSolFloor(pos.depositedLamports, 4)} SOL</span>
                {call.state === 'Settled' && (
                  <span className="text-xs text-ink-3 ml-2">
                    → {formatSolFloor(pos.claimableAmount, 4)} SOL
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skin-in-the-Game Thread Replies */}
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Thread replies ({call.replies?.length ?? 0})
          </h2>
          <a
            href={`https://explorer.solana.com/address/${call.pda}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Inspect CallPool PDA <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {!call.replies || call.replies.length === 0 ? (
          <p className="text-xs text-ink-3">
            No replies yet. Replies posted from the Seeker app automatically tag whether the author
            has SOL in this pool.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {call.replies.map((rep) => {
              const inPool = BigInt(rep.depositedLamports) > 0n;
              return (
                <div key={rep.id} className="py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {displayIdentity(rep.author, rep.authorSkr)}
                    </span>
                    <span
                      className={`num text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        inPool
                          ? 'bg-accent-soft text-accent-deep'
                          : 'bg-subtle text-ink-3 border border-line'
                      }`}
                    >
                      {rep.isCaller
                        ? `Caller · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                        : inPool
                          ? `In Pool · ${formatSolFloor(rep.depositedLamports, 2)} SOL`
                          : 'Spectator'}
                    </span>
                  </div>
                  <p className="text-sm text-ink-2">{rep.body}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DocsView({
  params,
  programIds,
}: {
  params: ProtocolParams;
  programIds: { percayaProgramId: string; ammProgramId: string };
}) {
  return (
    <div className="space-y-5">
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <h1 className="text-xl font-semibold text-ink">Protocol rules & honest limits</h1>
        <p className="text-sm text-ink-2 leading-relaxed">
          percaya enforces shared entry, shared exit, profit-only caller fees, and hardware-bound
          Seeker Genesis reputation on Solana. Parameters below are read live from protocol config.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Minimum caller bond</div>
            <div className="num text-sm font-semibold mt-0.5">
              {formatSolFloor(params.minBondLamports, 2)} SOL
            </div>
          </div>
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Minimum pool size</div>
            <div className="num text-sm font-semibold mt-0.5">
              {formatSolFloor(params.minPoolLamports, 2)} SOL
            </div>
          </div>
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Minimum caller stake</div>
            <div className="num text-sm font-semibold mt-0.5">
              {(params.minCallerBps / 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Max buy price impact</div>
            <div className="num text-sm font-semibold mt-0.5">
              {(params.maxImpactBps / 100).toFixed(2)}%
            </div>
          </div>
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Checkpoint gap</div>
            <div className="num text-sm font-semibold mt-0.5">{params.checkpointGapSec}s</div>
          </div>
          <div className="bg-subtle p-3 rounded-xl border border-line">
            <div className="text-xs text-ink-3">Keeper sale reward</div>
            <div className="num text-sm font-semibold mt-0.5">
              {(params.keeperBps / 100).toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <h2 className="text-base font-semibold text-ink">Honest limits</h2>
        <ul className="space-y-2 text-sm text-ink-2 list-disc pl-5">
          <li>
            <strong>Second wallets:</strong> Nothing stops an exchange-funded wallet buying before
            the pool completely. We put the caller&apos;s own SOL in the pool, lock their slashable
            bond, list pre-buy wallets, and gate Tiers 1–3 behind a 1-per-phone Seeker Genesis
            Token—making abuse costly and visible, never claiming it is impossible.
          </li>
          <li>
            <strong>Spaced spot quotes:</strong> Requiring two checkpoints separated by{' '}
            <span className="num">{params.checkpointGapSec}s</span> stops single-slot flash pushes;
            a price genuinely held across a full gap counts.
          </li>
          <li>
            <strong>Legal notice:</strong> Pooling capital with a profit-sharing caller resembles
            regulated collective investment schemes. This is an un-audited Devnet hackathon build.
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-4 pt-2 text-xs">
          <a
            href={`https://explorer.solana.com/address/${programIds.percayaProgramId}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline num"
          >
            percaya: {programIds.percayaProgramId.slice(0, 8)}… <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={`https://explorer.solana.com/address/${programIds.ammProgramId}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline num"
          >
            percaya_amm: {programIds.ammProgramId.slice(0, 8)}… <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function PrivacyView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-ink-2 hover:text-ink">
        ← Back to calls
      </button>
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <h1 className="text-lg font-semibold text-ink">Privacy Policy</h1>
        <p className="text-xs text-ink-3">Effective date: 27 November 2026 · Package: com.percaya.seeker</p>
        <ul className="space-y-2 text-sm text-ink-2 list-disc pl-5">
          <li>
            <strong>Non-custodial wallet keys:</strong> Private keys never leave your Solana Seeker
            Seed Vault or Mobile Wallet Adapter (MWA) wallet app. `percaya` only receives public
            wallet addresses and signed transactions or SIWS proofs.
          </li>
          <li>
            <strong>Camera permission (`android.permission.CAMERA`):</strong> Used strictly on-device
            to scan `percaya://c/:id` Call QR codes. No photos, video frames, or camera metadata are
            stored or transmitted.
          </li>
          <li>
            <strong>Notifications (`android.permission.POST_NOTIFICATIONS`):</strong> Used solely for
            local Android status notifications when calls you watch or join change on-chain state
            (`Holding`, `Settled`, `Refunded`, `Split`).
          </li>
          <li>
            <strong>Public blockchain data:</strong> Calls, stakes, rules, and settlements submitted
            to Solana Devnet are permanently public on the Solana ledger.
          </li>
          <li>
            <strong>Contact:</strong> For privacy inquiries or deletion of off-chain thread replies,
            contact <span className="num">team@percaya.app</span>.
          </li>
        </ul>
      </div>
    </div>
  );
}

function TermsView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-ink-2 hover:text-ink">
        ← Back to calls
      </button>
      <div className="bg-surface rounded-card border border-line p-5 shadow-card space-y-3">
        <h1 className="text-lg font-semibold text-ink">Terms of Use</h1>
        <p className="text-xs text-ink-3">Effective date: 27 November 2026 · MIT Open Source</p>
        <ul className="space-y-2 text-sm text-ink-2 list-disc pl-5">
          <li>
            <strong>Experimental Devnet software:</strong> `percaya` is an un-audited hackathon
            prototype running on Solana Devnet with test SOL and test SPL tokens. Do not use it with
            real Mainnet capital prior to independent security audits and legal structuring.
          </li>
          <li>
            <strong>No financial advice:</strong> Call theses and token selections are published by
            independent on-chain callers, never by `percaya`. Past settled returns do not predict
            future outcomes.
          </li>
          <li>
            <strong>On-chain immutability:</strong> Rules snapshotted at `open_call` cannot be
            altered by callers or admins. You are solely responsible for reviewing exit rules before
            signing any transaction in your wallet.
          </li>
          <li>
            <strong>Open-source license:</strong> Provided &ldquo;AS IS&rdquo; without warranty of
            any kind under the MIT License.
          </li>
        </ul>
      </div>
    </div>
  );
}
