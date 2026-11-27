/**
 * Deterministic price-mover CLI for live hackathon demos on Solana Devnet.
 * Reads live pool addresses automatically from `packages/core/src/devnet-deployment.json`.
 *
 * Usage:
 *   npm run move:price -- --token tBONK --sol 0.4
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LAMPORTS_PER_SOL_N, u64LeBytes } from '@percaya/core';
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

interface DevnetDeployment {
  rpcUrl: string;
  programs: { percaya: string; percayaAmm: string };
  tokens: Array<{
    symbol: string;
    mint: string;
    ammPool: string;
    ammSolVault: string;
    ammTokenVault: string;
    adminTokenAccount: string;
  }>;
}

async function main() {
  const args = process.argv.slice(2);
  const tokIdx = args.indexOf('--token');
  const solIdx = args.indexOf('--sol');
  const symbol = tokIdx !== -1 ? args[tokIdx + 1] : 'tBONK';
  const solAmount = solIdx !== -1 ? Number(args[solIdx + 1]) : 0.35;

  const deploymentPath = path.resolve('packages/core/src/devnet-deployment.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error('packages/core/src/devnet-deployment.json not found. Run `npm run seed:devnet` first.');
  }
  const dep = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')) as DevnetDeployment;
  const tok = dep.tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
  if (!tok) {
    throw new Error(`Token ${symbol} not found in devnet-deployment.json`);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL || dep.rpcUrl || 'https://api.devnet.solana.com';
  const keypairPath =
    process.env.TRADER_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const trader = Keypair.fromSecretKey(Uint8Array.from(secret));

  const conn = new Connection(rpcUrl, 'confirmed');
  const solInLamports = BigInt(Math.floor(solAmount * Number(LAMPORTS_PER_SOL_N)));
  const ammProgramId = new PublicKey(dep.programs.percayaAmm);

  const data = Buffer.concat([
    ixDisc('swap_exact_sol_for_tokens'),
    Buffer.from(u64LeBytes(solInLamports)),
    Buffer.from(u64LeBytes(1n)),
  ]);

  const ix = new TransactionInstruction({
    programId: ammProgramId,
    keys: [
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(tok.ammPool), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(tok.ammSolVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(tok.mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tok.ammTokenVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(tok.adminTokenAccount), isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: trader.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([trader]);

  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(
    `[move-price] Pumped $${tok.symbol} with ${solAmount} SOL on Devnet AMM (${tok.ammPool}) · tx: ${sig}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
