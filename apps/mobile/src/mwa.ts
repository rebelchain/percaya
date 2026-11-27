import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

export const APP_IDENTITY = {
  name: 'percaya',
  uri: 'https://percaya.app',
  icon: 'favicon.ico',
};

const DEVNET_RPC = 'https://api.devnet.solana.com';

export interface SeekerSession {
  pubkey: string;
  skrName: string | null;
  isSeekerVerified: boolean;
  mwaAuthToken: string | null;
  apiBearerToken: string | null;
  simulated: boolean;
}

/**
 * Connects to Seed Vault / Seed Vault Simulator via Mobile Wallet Adapter 2.0
 * and executes Sign-In With Solana (SIWS) in a single biometric prompt.
 */
export async function connectSeekerWallet(apiBaseUrl: string): Promise<SeekerSession> {
  let noncePayload: { nonce: string; domain: string; statement: string } | null = null;
  try {
    const res = await fetch(`${apiBaseUrl}/api/auth/nonce`);
    if (res.ok) {
      noncePayload = await res.json();
    }
  } catch {
    // Offline / local fallback
  }

  const result = await transact(async (wallet) => {
    const auth = await wallet.authorize({
      chain: 'solana:devnet',
      identity: APP_IDENTITY,
      sign_in_payload: noncePayload
        ? {
            domain: noncePayload.domain,
            statement: noncePayload.statement,
            nonce: noncePayload.nonce,
          }
        : undefined,
    });
    return auth;
  });

  const firstAccount = result.accounts[0];
  const pubkeyBytes = Uint8Array.from(atob(firstAccount.address), (c) => c.charCodeAt(0));
  const pubkey = new PublicKey(pubkeyBytes).toBase58();

  let apiBearerToken: string | null = null;
  if (result.sign_in_result && noncePayload) {
    try {
      const signedMsgUtf8 = atob(result.sign_in_result.signed_message);
      const verifyRes = await fetch(`${apiBaseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey,
          message: signedMsgUtf8,
          signatureBase64: result.sign_in_result.signature,
        }),
      });
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
