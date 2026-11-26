import crypto from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Ed25519 SubjectPublicKeyInfo ASN.1 DER prefix (12 bytes) */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function decodeBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (const char of input) {
    const val = BASE58_ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Invalid base58 character: ${char}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export interface SiwsChallenge {
  nonce: string;
  domain: string;
  statement: string;
  issuedAt: string;
  message: string;
}

const activeNonces = new Map<string, number>();

export function createSiwsChallenge(domain: string, address?: string): SiwsChallenge {
  const nonce = crypto.randomBytes(12).toString('hex');
  const issuedAt = new Date().toISOString();
  const statement =
    'Sign in to percaya on Solana Mobile to manage call alerts and watchlist preferences.';
  const accountLine = address ?? '<your-solana-pubkey>';
  const message = [
    `${domain} wants you to sign in with your Solana account:`,
    accountLine,
    '',
    statement,
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  activeNonces.set(nonce, Date.now() + 5 * 60 * 1000);
  // Prune expired nonces opportunistically
  for (const [k, exp] of activeNonces) {
    if (exp < Date.now()) activeNonces.delete(k);
  }

  return { nonce, domain, statement, issuedAt, message };
}

export function verifyEd25519Signature(
  pubkeyBase58: string,
  messageUtf8: string,
  signatureBase64OrBytes: string | Uint8Array,
): boolean {
  try {
    const pubBytes = decodeBase58(pubkeyBase58);
    if (pubBytes.length !== 32) return false;
    const sigBytes =
      typeof signatureBase64OrBytes === 'string'
        ? Buffer.from(signatureBase64OrBytes, 'base64')
        : Buffer.from(signatureBase64OrBytes);
    if (sigBytes.length !== 64) return false;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubBytes)]);
    const publicKey = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, Buffer.from(messageUtf8, 'utf8'), publicKey, sigBytes);
  } catch {
    return false;
  }
}

export function verifySiwsLogin(params: {
  pubkey: string;
  message: string;
  signatureBase64: string;
  requireNonce?: boolean;
}): boolean {
  const { pubkey, message, signatureBase64, requireNonce = true } = params;
  if (!message.includes(pubkey)) return false;

  if (requireNonce) {
    const match = /Nonce:\s*([a-f0-9]+)/i.exec(message);
    if (!match) return false;
    const nonce = match[1];
    const exp = activeNonces.get(nonce);
    if (!exp || exp < Date.now()) return false;
    activeNonces.delete(nonce);
  }

  return verifyEd25519Signature(pubkey, message, signatureBase64);
}

export function signSessionToken(pubkey: string, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const payload = Buffer.from(JSON.stringify({ sub: pubkey, exp })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifySessionToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string;
      exp: number;
    };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}
