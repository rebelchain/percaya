/**
 * Initializes GlobalConfig on Solana Devnet with hackathon demo parameters.
 *
 * Usage:
 *   npm run seed:devnet
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PERCAYA_PROGRAM_ID, DEMO_PROTOCOL_PARAMS, PDA_SEEDS } from '@percaya/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

function ixDisc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const keypairPath =
    process.env.ADMIN_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(keypairPath)) {
    console.log(
      `[seed-devnet] Create a Devnet wallet first with: solana-keygen new -o ${keypairPath} && solana airdrop 2 --url devnet`,
    );
    process.exit(0);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  const programId = new PublicKey(process.env.PERCAYA_PROGRAM_ID || DEFAULT_PERCAYA_PROGRAM_ID);
  const [configPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.config().map((b) => Buffer.from(b)),
    programId,
  );

  const conn = new Connection(rpcUrl, 'confirmed');
  const existing = await conn.getAccountInfo(configPda);
  if (existing) {
    console.log(`[seed-devnet] GlobalConfig already initialized at ${configPda.toBase58()}`);
    return;
  }

  const p = DEMO_PROTOCOL_PARAMS;
  const paramsBuf = Buffer.alloc(8 + 8 + 4 * 8 + 2 * 6);
  let o = 0;
  paramsBuf.writeBigUInt64LE(BigInt(p.minBondLamports), o);
  o += 8;
  paramsBuf.writeBigUInt64LE(BigInt(p.minPoolLamports), o);
  o += 8;
  for (const u32Val of [
    p.minWindowSec,
    p.maxWindowSec,
    p.buyGraceSec,
    p.minHoldSec,
    p.maxHoldSec,
    p.checkpointGapSec,
    p.splitGraceSec,
    p.bondCooldownSec,
  ]) {
    paramsBuf.writeUInt32LE(u32Val, o);
    o += 4;
  }
  for (const u16Val of [
    p.minStopLossBps,
    p.maxStopLossBps,
    p.minCallerBps,
    p.maxImpactBps,
    p.sellToleranceBps,
    p.keeperBps,
  ]) {
    paramsBuf.writeUInt16LE(u16Val, o);
    o += 2;
  }

  const data = Buffer.concat([
    ixDisc('initialize_config'),
    paramsBuf,
    admin.publicKey.toBuffer(), // genesis_authority = admin on Devnet
    admin.publicKey.toBuffer(), // treasury = admin on Devnet
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: admin.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([admin]);

  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[seed-devnet] Initialized GlobalConfig ${configPda.toBase58()} · tx: ${sig}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
