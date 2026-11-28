import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTES } from './tokens.ts';
import {
  formatCountdownShort,
  formatDurationCompact,
  formatTimeAgo,
  getIdenticonSpec,
  wcagContrastRatio,
} from './format.ts';

test('Light & Dark palettes meet WCAG AA (>= 4.5:1) for primary, secondary, and semantic status text', () => {
  for (const mode of ['light', 'dark'] as const) {
    const p = PALETTES[mode];
    assert.ok(wcagContrastRatio(p.ink, p.surface) >= 4.5, `${mode} ink on surface`);
    assert.ok(wcagContrastRatio(p.ink2, p.surface) >= 4.5, `${mode} ink2 on surface`);
    assert.ok(wcagContrastRatio(p.ink3, p.surface) >= 4.5, `${mode} ink3 on surface`);
    assert.ok(wcagContrastRatio(p.ink3, p.bg) >= 4.5, `${mode} ink3 on bg`);
    assert.ok(wcagContrastRatio(p.openText, p.openFill) >= 4.5, `${mode} openText on openFill`);
    assert.ok(wcagContrastRatio(p.holdingText, p.holdingFill) >= 4.5, `${mode} holdingText on holdingFill`);
    assert.ok(wcagContrastRatio(p.gainText, p.gainFill) >= 4.5, `${mode} gainText on gainFill`);
    assert.ok(wcagContrastRatio(p.lossText, p.lossFill) >= 4.5, `${mode} lossText on lossFill`);
    assert.ok(wcagContrastRatio(p.refundedText, p.refundedFill) >= 4.5, `${mode} refundedText on refundedFill`);
  }
});

test('formatCountdownShort formats open pool remaining windows accurately', () => {
  assert.equal(formatCountdownShort(1000, 1005), null);
  assert.equal(formatCountdownShort(1042, 1000), '42s left');
  assert.equal(formatCountdownShort(1135, 1000), '2m 15s left');
  assert.equal(formatCountdownShort(1720, 1000), '12m left');
});

test('formatTimeAgo and formatDurationCompact produce calm trader timestamps', () => {
  assert.equal(formatTimeAgo(980, 1000), '20s');
  assert.equal(formatTimeAgo(400, 1000), '10m');
  assert.equal(formatDurationCompact(900), '15m');
});

test('getIdenticonSpec is deterministic per wallet address and varies across wallets', () => {
  const a1 = getIdenticonSpec('68XA2EopzsaZxtHbDxr7gey1eHBBvQDX4D9vTkW44y2i');
  const a2 = getIdenticonSpec('68XA2EopzsaZxtHbDxr7gey1eHBBvQDX4D9vTkW44y2i');
  const b = getIdenticonSpec('BGhC999999999999999999999999999999999999B8Nw');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
});
