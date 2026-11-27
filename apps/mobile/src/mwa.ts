import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

export const APP_IDENTITY = {
  name: 'percaya',
  uri: 'https://percaya.app',
  icon: 'favicon.ico',
};

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
 * Signs and dispatches a VersionedTransaction through Seed Vault / MWA 2.0.
 */
export async function signAndSendViaSeedVault(
  serializedTxBase64: string,
  mwaAuthToken: string | null,
): Promise<string> {
  const rawBytes = Uint8Array.from(atob(serializedTxBase64), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(rawBytes);

  const signatures = await transact(async (wallet) => {
    if (mwaAuthToken) {
      await wallet.reauthorize({ auth_token: mwaAuthToken, identity: APP_IDENTITY });
    } else {
      await wallet.authorize({ cluster: 'devnet', identity: APP_IDENTITY });
    }
    return wallet.signAndSendTransactions({
      transactions: [tx],
    });
  });

  return signatures[0];
}
