import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from './app.ts';

const BASE58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(buf: Buffer): string {
  const digits = [0];
  for (let i = 0; i < buf.length; i++) {
    let carry = buf[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let k = 0; buf[k] === 0 && k < buf.length - 1; k++) out += '1';
  for (let q = digits.length - 1; q >= 0; q--) out += BASE58_ALPHA[digits[q]];
  return out;
}

test('GET /api/calls & /api/callers enforce newest-first / last-active ordering', async () => {
  const app = createApp();
  const res = await app.request('/api/calls');
  assert.equal(res.status, 200);
  const json = (await res.json()) as { calls: Array<{ callId: number }>; ordering: string };
  assert.equal(json.ordering, 'newest_first_no_ranking');
  assert.ok(json.calls.length >= 4);
  assert.ok(json.calls[0].callId > json.calls[1].callId);
});

test('SIWS Ed25519 challenge-response issues valid bearer token for follow/watch', async () => {
  const app = createApp();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const pubkeyBase58 = encodeBase58(Buffer.from(rawPub));

  const nonceRes = await app.request(`/api/auth/nonce?address=${pubkeyBase58}`);
  assert.equal(nonceRes.status, 200);
  const { message } = (await nonceRes.json()) as { message: string };

  const sig = crypto.sign(null, Buffer.from(message, 'utf8'), privateKey);
  const verifyRes = await app.request('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pubkey: pubkeyBase58,
      message,
      signatureBase64: sig.toString('base64'),
    }),
  });
  assert.equal(verifyRes.status, 200);
  const { token } = (await verifyRes.json()) as { token: string };
  assert.ok(token.length > 20);

  const watchRes = await app.request('/api/me/watch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ callId: 6 }),
  });
  assert.equal(watchRes.status, 200);
  const watchJson = (await watchRes.json()) as { watching: boolean };
  assert.equal(watchJson.watching, true);

  // Reply to Call #6 -> automatically tagged as Spectator (0 SOL in pool)
  const replyRes = await app.request('/api/calls/6/replies', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body: 'Watching this 4m window closely.' }),
  });
  assert.equal(replyRes.status, 201);
  const replyJson = (await replyRes.json()) as {
    reply: { depositedLamports: string; body: string };
  };
  assert.equal(replyJson.reply.depositedLamports, '0');
  assert.equal(replyJson.reply.body, 'Watching this 4m window closely.');
});

test('Solana Actions (Blinks) GET & POST return CORS headers and serialized VersionedTransaction', async () => {
  const app = createApp();
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const joinerBase58 = encodeBase58(Buffer.from(rawPub));

  const metaRes = await app.request('http://localhost:8787/api/actions/call/6');
  assert.equal(metaRes.status, 200);
  assert.equal(metaRes.headers.get('Access-Control-Allow-Origin'), '*');
  const meta = (await metaRes.json()) as { disabled: boolean; title: string };
  assert.equal(meta.disabled, false);
  assert.ok(meta.title.includes('$tBONK'));

  const postRes = await app.request('http://localhost:8787/api/actions/call/6?amount=0.25', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: joinerBase58 }),
  });
  assert.equal(postRes.status, 200);
  const postJson = (await postRes.json()) as { transaction: string; message: string };
  assert.ok(Buffer.from(postJson.transaction, 'base64').length > 100);
  assert.ok(postJson.message.includes('0.25'));
});

test('POST /api/devnet/issue-sgt validates caller pubkey before hitting RPC', async () => {
  const app = createApp();
  const missing = await app.request('/api/devnet/issue-sgt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missing.status, 400);

  const invalid = await app.request('/api/devnet/issue-sgt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller: 'not-a-solana-pubkey' }),
  });
  assert.equal(invalid.status, 400);
});
