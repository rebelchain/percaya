/**
 * Opens a real on-chain Call Pool on Solana Devnet using the Seeker-verified admin wallet,
 * then runs `syncDevnetOnce` to verify our API Indexer decodes live Devnet PDAs accurately.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDA_SEEDS } from '@percaya/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { encodeOpenCallIxData } from '../apps/api/src/chain.ts';
import { loadDevnetDeployment, syncDevnetOnce } from '../apps/api/src/devnet-sync.ts';
import { createPercayaStore } from '../apps/api/src/store.ts';

async function main() {
  const dep = loadDevnetDeployment();
  if (!dep) throw new Error('devnet-deployment.json missing');

  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const caller = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[]),
  );
  const conn = new Connection(dep.rpcUrl, 'confirmed');
  const programId = new PublicKey(dep.programs.percaya);
  const configPda = new PublicKey(dep.configPda);

  const cfgAcct = await conn.getAccountInfo(configPda);
  if (!cfgAcct) throw new Error('GlobalConfig not found on Devnet');
  // Offset: 8 disc + 32 admin + 32 pending_admin + 32 treasury + 32 genesis_authority = 136 -> u64 next_call_id
  const nextCallId = Number(cfgAcct.data.readBigUInt64LE(136));
  const tBonk = dep.tokens[0];

  if (nextCallId === 1) {
    const [callerRecord] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.caller(caller.publicKey.toBytes()).map((b) => Buffer.from(b)),
      programId,
    );
    const [allowedToken] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.allowedToken(new PublicKey(tBonk.mint).toBytes()).map((b) => Buffer.from(b)),
      programId,
    );
    const [callPool] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.call(nextCallId).map((b) => Buffer.from(b)),
      programId,
    );
    const [solVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.solVault(nextCallId).map((b) => Buffer.from(b)),
      programId,
    );
    const [callerPos] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.position(nextCallId, caller.publicKey.toBytes()).map((b) => Buffer.from(b)),
      programId,
    );

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: caller.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: callerRecord, isSigner: false, isWritable: true },
        { pubkey: allowedToken, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(tBonk.ammPool), isSigner: false, isWritable: false },
        { pubkey: callPool, isSigner: false, isWritable: true },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: callerPos, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeOpenCallIxData({
        windowDuration: 300, // 5 min
        takeProfitBps: 2000, // +20%
        stopLossBps: 1500, // -15%
        maxHoldDuration: 900, // 15 min
        shareBps: 500, // 5% Tier 0 max
        stakeLamports: 12_000_000n, // 0.012 SOL (well within 2% impact of 0.85 SOL tBONK pool)
        thesis:
          'First live Solana Devnet pooled call on $tBONK. Seeker Genesis Token-2022 linked; immutable +20% TP / −15% SL.',
      }),
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: caller.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([caller]);
    const sig = await conn.sendTransaction(tx);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[open-demo-call] Opened LIVE Devnet Call #${nextCallId} · tx: ${sig}`);
  } else {
    console.log(`[open-demo-call] Devnet already has ${nextCallId - 1} call(s) on chain.`);
  }

  // Verify live DATA=chain Indexer decodes everything cleanly from Solana Devnet!
  const store = createPercayaStore('chain');
  const stats = await syncDevnetOnce(store, dep.rpcUrl);
  const liveCalls = store.listCalls();
  console.log('[open-demo-call] Live Indexer stats:', stats);
  console.log(
    '[open-demo-call] Decoded Call #1:',
    JSON.stringify(
      {
        callId: liveCalls[0]?.callId,
        token: liveCalls[0]?.token.symbol,
        state: liveCalls[0]?.state,
        callerSeekerVerified: liveCalls[0]?.callerSeekerVerified,
        totalInLamports: liveCalls[0]?.totalInLamports,
        liveCapLamports: liveCalls[0]?.liveCapLamports,
        thesis: liveCalls[0]?.thesis,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
