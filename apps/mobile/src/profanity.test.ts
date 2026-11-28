import assert from 'node:assert/strict';
import test from 'node:test';
import { containsProfanity } from './profanity.ts';

test('containsProfanity flags harsh profanity while allowing normal crypto trader jargon', () => {
  assert.equal(
    containsProfanity('One pooled entry on clean Devnet liquidity; TP +25% and SL -12% fixed at open.'),
    false,
  );
  assert.equal(containsProfanity('Slippage capped at 2% with pro-rata SOL exit.'), false);
  assert.equal(containsProfanity('What the fuck is this candle'), true);
  assert.equal(containsProfanity('Total bullshit pump'), true);
});
