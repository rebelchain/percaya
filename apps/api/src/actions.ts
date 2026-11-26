import {
  BPS_DENOMINATOR_N,
  LAMPORTS_PER_SOL_N,
  PDA_SEEDS,
  displayIdentity,
  formatSignedPct,
  formatSolFloor,
  impactBps,
  type CallDetail,
} from '@percaya/core';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { encodeDepositIxData, encodeInitPositionIxData, getProgramIds } from './chain.ts';

export const ACTIONS_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.2.1',
  'X-Blockchain-Ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Solana Devnet CAIP-2
};

/**
 * Generates a calm, editorial SVG share/Blink card strictly matching design.md tokens:
 * Light background (#F2F5F7), white card (#FFFFFF), brand slate-blue (#1F6E9C), ink (#0F1D24).
 */
export function renderCallCardSvg(call: CallDetail): string {
  const callerLabel = displayIdentity(call.caller, call.callerSkr);
  const badgeLabel = call.callerSeekerVerified
    ? `Seeker Genesis · Tier ${call.callerTier}`
    : 'Unverified Wallet · Tier 0';

  const statusText =
    call.state === 'Settled'
      ? `Settled · ${formatSignedPct(call.netReturnBps)} net`
      : call.state === 'Holding'
        ? `Holding · ${formatSignedPct(call.liveQuoteNetBps)} quote`
        : call.state === 'Open'
          ? `Open · ${formatSolFloor(call.totalInLamports, 2)} / ${formatSolFloor(call.liveCapLamports, 2)} SOL`
          : call.state;

  const statusFill =
    call.state === 'Settled' && (call.netReturnBps ?? 0) > 0
      ? '#0A8A5F'
      : call.state === 'Settled' && (call.netReturnBps ?? 0) < 0
        ? '#D23A2F'
        : '#1F6E9C';

  const tpLabel =
    call.rules.takeProfitBps > 0 ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%` : 'None';
  const slLabel = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;
  const feeLabel = `${(call.rules.shareBps / 100).toFixed(0)}% profit only`;

  const escapedThesis = call.thesis
    .slice(0, 96)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">
  <rect width="800" height="420" fill="#F2F5F7"/>
  <rect x="28" y="28" width="744" height="364" rx="20" fill="#FFFFFF" stroke="#E2E8EC" stroke-width="2"/>
  <text x="60" y="78" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700" fill="#0F1D24">percaya</text>
  <text x="155" y="78" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#66777F">One buy. One sale. The same price for everyone.</text>
  <rect x="540" y="54" width="200" height="34" rx="17" fill="${statusFill}"/>
  <text x="640" y="76" text-anchor="middle" font-family="monospace" font-size="14" font-weight="600" fill="#FFFFFF">${statusText}</text>

  <text x="60" y="148" font-family="Inter, system-ui, sans-serif" font-size="40" font-weight="700" fill="#0F1D24">$${call.token.symbol}</text>
  <text x="60" y="182" font-family="Inter, system-ui, sans-serif" font-size="17" fill="#364852">${callerLabel}  ·  ${badgeLabel}  ·  ${call.callerSettled} settled (${call.callerLosses} losses)</text>
  <text x="60" y="220" font-family="Inter, system-ui, sans-serif" font-size="16" fill="#66777F">${escapedThesis}</text>

  <rect x="60" y="254" width="680" height="72" rx="12" fill="#F6F8FA" stroke="#E2E8EC"/>
  <text x="84" y="282" font-family="Inter, system-ui, sans-serif" font-size="13" fill="#66777F">FIXED AT OPEN (IMMUTABLE)</text>
  <text x="84" y="308" font-family="monospace" font-size="17" font-weight="600" fill="#0F1D24">TP ${tpLabel}   ·   SL ${slLabel}   ·   Max Hold ${Math.round(call.rules.maxHoldSec / 60)}m   ·   Fee ${feeLabel}</text>

  <text x="60" y="364" font-family="monospace" font-size="14" fill="#1F6E9C">Caller stake locked: ${formatSolFloor(call.callerStakeLamports, 2)} SOL (min 5%) · Max buy impact: 2.00%</text>
</svg>`;
}

export function buildActionMetadata(call: CallDetail, baseUrl: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  const isOpen = call.state === 'Open' && nowSec < call.rules.windowEnd;
  const callerLabel = displayIdentity(call.caller, call.callerSkr);
  const tp =
    call.rules.takeProfitBps > 0 ? `+${(call.rules.takeProfitBps / 100).toFixed(0)}%` : 'None';
  const sl = `−${(call.rules.stopLossBps / 100).toFixed(0)}%`;

  return {
    type: 'action',
    icon: `${baseUrl}/api/calls/${call.callId}/card.svg`,
    title: `percaya Call #${call.callId} · $${call.token.symbol} by ${callerLabel}`,
    description: `${call.thesis}\n\nLocked rules: TP ${tp} · SL ${sl} · Max hold ${Math.round(call.rules.maxHoldSec / 60)}m · Profit-only fee ${(call.rules.shareBps / 100).toFixed(1)}%. Caller has ${formatSolFloor(call.callerStakeLamports, 2)} SOL locked at the same price.`,
    label: isOpen ? 'Join Pooled Call' : `Call ${call.state}`,
    disabled: !isOpen,
    links: isOpen
      ? {
          actions: [
            {
              type: 'transaction',
              label: 'Deposit 0.10 SOL',
              href: `${baseUrl}/api/actions/call/${call.callId}?amount=0.1`,
            },
            {
              type: 'transaction',
              label: 'Deposit 0.25 SOL',
              href: `${baseUrl}/api/actions/call/${call.callId}?amount=0.25`,
            },
            {
              type: 'transaction',
              label: 'Join Pool',
              href: `${baseUrl}/api/actions/call/${call.callId}?amount={amount}`,
              parameters: [
                {
                  name: 'amount',
                  label: 'SOL amount (e.g. 0.15)',
                  required: true,
                },
              ],
            },
          ],
        }
      : undefined,
  };
}

export async function buildBlinkDepositTransaction(params: {
  call: CallDetail;
  accountBase58: string;
  amountSol: number;
  rpcUrl: string;
}): Promise<{ transactionBase64: string; message: string }> {
  const { call, accountBase58, amountSol, rpcUrl } = params;
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error('Deposit amount must be greater than 0 SOL');
  }
  const lamports = BigInt(Math.floor(amountSol * 1_000_000_000));
  if (lamports <= 0n) {
    throw new Error('Deposit amount in lamports must be positive');
  }

  const newTotal = BigInt(call.totalInLamports) + lamports;
  if (newTotal > BigInt(call.rules.capLamports)) {
    throw new Error('Deposit exceeds caller bond tier cap');
  }

  const callerStake =
    accountBase58 === call.caller
      ? BigInt(call.callerStakeLamports) + lamports
      : BigInt(call.callerStakeLamports);

  if (callerStake * BPS_DENOMINATOR_N < newTotal * BigInt(call.rules.minCallerBps)) {
    throw new Error('Deposit would dilute caller below minimum 5% pool share');
  }

  const impact = impactBps(
    BigInt(call.token.solReserveLamports),
    newTotal,
    BigInt(call.token.feeBps),
  );
  if (impact > call.rules.maxImpactBps) {
    throw new Error(`Pool buy price impact (${(impact / 100).toFixed(2)}%) exceeds 2.00% limit`);
  }

  const participant = new PublicKey(accountBase58);
  const { percayaProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);

  const [callPoolPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.call(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.position(call.callId, participant.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  // Use a valid PublicKey for ammPool (either real chain key or deterministic PDA in demo mode)
  let ammPoolKey: PublicKey;
  try {
    ammPoolKey = new PublicKey(call.rules.ammPool);
  } catch {
    ammPoolKey = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_pool'), Buffer.alloc(32, call.callId)],
      programId,
    )[0];
  }

  const ixs: TransactionInstruction[] = [];
  const existingPos = call.positions.find((p) => p.participant === accountBase58);
  if (!existingPos) {
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: participant, isSigner: true, isWritable: true },
          { pubkey: callPoolPda, isSigner: false, isWritable: false },
          { pubkey: positionPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInitPositionIxData(),
      }),
    );
  }

  ixs.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: participant, isSigner: true, isWritable: true },
        { pubkey: callPoolPda, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: ammPoolKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeDepositIxData(lamports),
    }),
  );

  let recentBlockhash = '11111111111111111111111111111111';
  if (process.env.DATA === 'chain') {
    const conn = new Connection(rpcUrl, 'confirmed');
    const latest = await conn.getLatestBlockhash('confirmed');
    recentBlockhash = latest.blockhash;
  }

  const msgV0 = new TransactionMessage({
    payerKey: participant,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(msgV0);
  const transactionBase64 = Buffer.from(tx.serialize()).toString('base64');

  return {
    transactionBase64,
    message: `Depositing ${formatSolFloor(lamports, 4)} SOL into Call #${call.callId} ($${call.token.symbol}). Same entry and exit price as ${displayIdentity(call.caller, call.callerSkr)}.`,
  };
}
