import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCallDeepLink, buildCallWebLink, parseCallIdFromLink } from './call-links.ts';

test('call links round-trip through the parser', () => {
  assert.equal(parseCallIdFromLink(buildCallDeepLink(3)), 3);
  assert.equal(parseCallIdFromLink(buildCallWebLink(12)), 12);
  assert.equal(parseCallIdFromLink('  percaya://c/7?src=qr '), 7);
});

test('call link parser rejects foreign or malformed payloads', () => {
  assert.equal(parseCallIdFromLink('https://evil.example/c/3'), null);
  assert.equal(parseCallIdFromLink('percaya://c/abc'), null);
  assert.equal(parseCallIdFromLink('solana:Abc123'), null);
  assert.equal(parseCallIdFromLink(''), null);
});
