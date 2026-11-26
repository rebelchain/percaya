/**
 * Deterministic price-mover CLI for live hackathon demos on Solana Devnet.
 *
 * Usage:
 *   npm run move:price -- --token tBONK --pump 25
 *   npm run move:price -- --token tWIF  --dump 20
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  LAMPORTS_PER_SOL_N,
  PDA_SEEDS,
  u64LeBytes,
} from '@percaya/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const SPL_TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

function ixDisc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const args = process.argv.slice(2);
  const mintArgIdx = args.indexOf('--mint');
  const solArgIdx = args.indexOf('--sol');
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

  if (mintArgIdx === -1) {
    console.log(
      'Usage: npm run move:price -- --mint <TOKEN_MINT_PUBKEY> [--sol 1.5] (swaps SOL -> SPL on percaya_amm to push quote above Take-Profit)',
    );
    process.exit(0);
  }

  const tokenMint = new PublicKey(args[mintArgIdx + 1]);
  const solAmount = solArgIdx !== -1 ? Number(args[solArgIdx + 1]) : 1.0;
  const solInLamports = BigInt(Math.floor(solAmount * Number(LAMPORTS_PER_SOL_N)));

  const keypairPath =
    process.env.TRADER_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const trader = Keypair.fromSecretKey(Uint8Array.from(secret));

  const ammProgramId = new PublicKey(
    process.env.PERCAYA_AMM_PROGRAM_ID || DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  );
  const [ammPool] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.ammPool(tokenMint.toBytes()).map((b) => Buffer.from(b)),
    ammProgramId,
  );
  const [ammSolVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
    ammProgramId,
  );

  const conn = new Connection(rpcUrl, 'confirmed');
  const poolAcct = await conn.getAccountInfo(ammPool);
  if (!poolAcct) {
    throw new Error(`AmmPool ${ammPool.toBase58()} not found on ${rpcUrl}`);
  }
  // Layout: 8 disc + 32 authority + 32 token_mint + 32 token_vault
  const tokenVault = new PublicKey(poolAcct.data.subarray(72, 104));
  const traderTokenOut = new PublicKey(args[args.indexOf('--ata') + 1]);

  const data = Buffer.concat([
    ixDisc('swap_exact_sol_for_tokens'),
    Buffer.from(u64LeBytes(solInLamports)),
    Buffer.from(u64LeBytes(1n)),
  ]);

  const ix = new TransactionInstruction({
    programId: ammProgramId,
    keys: [
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammPool, isSigner: false, isWritable: true },
      { pubkey: ammSolVault, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: traderTokenOut, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: trader.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([trader]);

  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[move-price] Swapped ${solAmount} SOL into ${ammPool.toBase58()} · tx: ${sig}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
