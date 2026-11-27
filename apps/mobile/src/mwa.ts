import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';

export const APP_IDENTITY = {
  name: 'percaya',
  uri: 'https://percaya.app',
  icon: 'favicon.ico',
};

export const DEVNET_RPC = 'https://api.devnet.solana.com';

export interface SeekerSession {
  pubkey: string;
  skrName: string | null;
  isSeekerVerified: boolean;
  mwaAuthToken: string | null;
  apiBearerToken: string | null;
  simulated: boolean;
}

async function fetchShort(url: string, init?: RequestInit, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Connects to Seed Vault, Solflare, Phantom, or Fake Wallet via Mobile Wallet Adapter 2.0.
 * Attempts 1-prompt SIWS when an API nonce is available, and falls back gracefully to standard
 * MWA `authorize` if the wallet (e.g. Fake Wallet / legacy MWA) does not support `sign_in_payload`.
 */
export async function connectSeekerWallet(apiBaseUrl: string | null): Promise<SeekerSession> {
  let noncePayload: { nonce: string; domain: string; statement: string } | null = null;
  if (apiBaseUrl) {
    try {
      const res = await fetchShort(`${apiBaseUrl}/api/auth/nonce`, undefined, 2000);
      if (res.ok) {
        noncePayload = await res.json();
      }
    } catch {
      // Offline / direct Devnet mode — proceed with standard MWA authorize
    }
  }

  const result = await transact(async (wallet) => {
    if (noncePayload) {
      try {
        return await wallet.authorize({
          chain: 'solana:devnet',
          identity: APP_IDENTITY,
          sign_in_payload: {
            domain: noncePayload.domain,
            statement: noncePayload.statement,
            nonce: noncePayload.nonce,
          },
        });
      } catch {
        // Fallback for Fake Wallet / wallets without MWA 2.0 SIWS support
      }
    }
    return wallet.authorize({
      chain: 'solana:devnet',
      identity: APP_IDENTITY,
    });
  });

  const firstAccount = result.accounts[0];
  const pubkeyBytes = Uint8Array.from(atob(firstAccount.address), (c) => c.charCodeAt(0));
  const pubkey = new PublicKey(pubkeyBytes).toBase58();

  let apiBearerToken: string | null = null;
  if (apiBaseUrl && result.sign_in_result && noncePayload) {
    try {
      const signedMsgUtf8 = atob(result.sign_in_result.signed_message);
      const verifyRes = await fetchShort(
        `${apiBaseUrl}/api/auth/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pubkey,
            message: signedMsgUtf8,
            signatureBase64: result.sign_in_result.signature,
          }),
        },
        3000,
      );
      if (verifyRes.ok) {
        const verified = (await verifyRes.json()) as { token: string };
        apiBearerToken = verified.token;
      }
    } catch {
      // Continue with on-chain MWA authorization even if API session endpoint is unreachable
    }
  }

  return {
    pubkey,
    skrName: firstAccount.label?.endsWith('.skr') ? firstAccount.label : null,
    isSeekerVerified: false,
    mwaAuthToken: result.auth_token,
    apiBearerToken,
    simulated: false,
  };
}

/**
 * Reads the connected wallet's live SOL balance directly from Solana Devnet RPC.
 */
export async function fetchDevnetBalanceSol(pubkey: string): Promise<number> {
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const lamports = await conn.getBalance(new PublicKey(pubkey), 'confirmed');
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Funds a 0-SOL judge / tester wallet on Solana Devnet via the hosted micro-faucet (0.08 SOL)
 * or direct Devnet RPC `requestAirdrop` fallback.
 */
export async function requestJudgeDevnetFaucet(
  pubkey: string,
  apiBaseUrl: string | null,
): Promise<{ signature: string; amountSol: number; source: 'api' | 'rpc' }> {
  if (apiBaseUrl) {
    try {
      const res = await fetchShort(
        `${apiBaseUrl}/api/faucet`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkey }),
        },
        15_000,
      );
      if (res.ok) {
        const data = (await res.json()) as { signature: string; amountSol: number };
        return { signature: data.signature, amountSol: data.amountSol, source: 'api' };
      }
    } catch {
      // Fall through to direct Devnet RPC airdrop
    }
  }

  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const sig = await conn.requestAirdrop(new PublicKey(pubkey), Math.round(0.1 * LAMPORTS_PER_SOL));
  await conn.confirmTransaction(sig, 'confirmed').catch(() => {});
  return { signature: sig, amountSol: 0.1, source: 'rpc' };
}

/**
 * Signs and sends a VersionedTransaction via Seed Vault / MWA 2.0 (`signAndSendTransactions`).
 *
 * Solflare Android has a known MWA quirk where it broadcasts the transaction to Devnet on
 * swipe-approve and immediately closes the local MWA WebSocket before returning the RPC
 * response, throwing `CancellationException` / `Local association cancelled`. When that
 * occurs, we verify directly against Devnet RPC whether the fee payer landed a new confirmed
 * transaction right after the prompt so the user gets an accurate on-chain receipt.
 */
export async function signAndSendViaSeedVault(
  serializedTxBase64: string,
  mwaAuthToken: string | null,
): Promise<string> {
  const rawBytes = Uint8Array.from(atob(serializedTxBase64), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(rawBytes);
  const payer = tx.message.staticAccountKeys[0];
  const conn = new Connection(DEVNET_RPC, 'confirmed');

  let prevSig: string | null = null;
  try {
    const recent = await conn.getSignaturesForAddress(payer, { limit: 1 });
    prevSig = recent[0]?.signature ?? null;
  } catch {
    // Best-effort baseline before MWA prompt
  }
  const startedAtSec = Math.floor(Date.now() / 1000);

  try {
    const signatures = await transact(async (wallet) => {
      if (mwaAuthToken) {
        await wallet.authorize({
          auth_token: mwaAuthToken,
          chain: 'solana:devnet',
          identity: APP_IDENTITY,
        });
      } else {
        await wallet.authorize({ chain: 'solana:devnet', identity: APP_IDENTITY });
      }
      return wallet.signAndSendTransactions({
        transactions: [tx],
      });
    });

    const sig = signatures[0];
    if (sig) {
      await conn.confirmTransaction(sig, 'confirmed').catch(() => {});
      return sig;
    }
    throw new Error('Wallet returned empty transaction signature');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const maybePostBroadcastDisconnect =
      msg.includes('CancellationException') ||
      msg.includes('cancelled') ||
      msg.includes('closed') ||
      msg.includes('SESSION_CLOSED');

    if (maybePostBroadcastDisconnect) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const latest = await conn.getSignaturesForAddress(payer, { limit: 5 });
          const landed = latest.find(
            (s) =>
              s.signature !== prevSig &&
              s.err === null &&
              (s.blockTime ?? startedAtSec) >= startedAtSec - 15,
          );
          if (landed) {
            return landed.signature;
          }
        } catch {
          // Keep polling
        }
      }
    }
    throw err;
  }
}
