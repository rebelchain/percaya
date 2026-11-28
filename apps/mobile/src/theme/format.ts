/**
 * Pure formatting, countdown, and deterministic visual helpers for `percaya`.
 */

export function formatTimeAgo(unixSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!unixSec || unixSec <= 0) return 'just now';
  const diff = Math.max(1, nowSec - unixSec);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function formatCountdownShort(targetUnixSec: number, nowSec = Math.floor(Date.now() / 1000)): string | null {
  const remaining = targetUnixSec - nowSec;
  if (remaining <= 0) return null;
  if (remaining < 60) return `${remaining}s left`;
  if (remaining < 3600) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return mins < 5 && secs > 0 ? `${mins}m ${secs}s left` : `${mins}m left`;
  }
  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
}

export function formatDurationCompact(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const IDENTICON_PAIRS: readonly [string, string, string][] = [
  ['#0F3D5E', '#2D8BBA', '#A8E0FF'],
  ['#0B4F3F', '#149674', '#9DF2D6'],
  ['#2A2E5B', '#5863C7', '#C3CAFF'],
  ['#4A264F', '#9B4FA3', '#F2C2F7'],
  ['#1B3B4B', '#3E7C96', '#BCE4F5'],
  ['#3B3322', '#8C7239', '#F5DFA6'],
  ['#193833', '#2A7B6F', '#A7EDE2'],
  ['#2E2742', '#6C5A99', '#D8CEFA'],
];

export function getIdenticonSpec(seed: string): {
  startColor: string;
  endColor: string;
  accentColor: string;
  angleDeg: number;
  shapeIndex: number;
} {
  const h = hashSeed(seed || 'percaya');
  const pair = IDENTICON_PAIRS[h % IDENTICON_PAIRS.length];
  return {
    startColor: pair[0],
    endColor: pair[1],
    accentColor: pair[2],
    angleDeg: (h >>> 4) % 360,
    shapeIndex: (h >>> 8) % 4,
  };
}

/**
 * Relative luminance + WCAG 2.1 contrast ratio helper for automated AA verification.
 */
export function wcagContrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string): number => {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(hexA);
  const l2 = lum(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
