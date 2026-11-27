/**
 * RPC-efficient, idempotent Solana Devnet seeder for `percaya`.
 *
 * 1. Initializes `GlobalConfig` (skips if already live)
 * 2. Creates 3 SPL demo tokens (`tBONK`, `tWIF`, `tSKR`) + `percaya_amm` pools in batched txs
 * 3. Registers all 3 tokens on `percaya` (`AllowedToken` PDAs)
 * 4. Mints a real SPL Token-2022 `NonTransferable` Devnet Seeker Genesis NFT & verifies caller
 * 5. Writes `packages/core/src/devnet-deployment.json`
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  DEFAULT_PERCAYA_PROGRAM_ID,
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

const SPL_TOKEN_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const DEPLOYMENT_OUT = path.resolve('packages/core/src/devnet-deployment.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ixDisc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function sendAndConfirm(
  conn: Connection,
  payer: Keypair,
  extraSigners: Keypair[],
  instructions: TransactionInstruction[],
): Promise<string> {
  await sleep(1200);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extraSigners]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false, maxRetries: 5 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

function buildInitMint2Ix(
  mint: PublicKey,
  authority: PublicKey,
  decimals: number,
  tokenProgram: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(35);
  data[0] = 20; // InitializeMint2
  data[1] = decimals;
  authority.toBuffer().copy(data, 2);
  data[34] = 0;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  });
}

function buildInitAccount3Ix(
  acct: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: acct, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]), // InitializeAccount3
  });
}

function buildMintToIx(
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint,
  tokenProgram: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), Buffer.from(u64LeBytes(amount))]),
  });
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const keypairPath =
    process.env.ADMIN_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));

  const percayaProgramId = new PublicKey(
    process.env.PERCAYA_PROGRAM_ID || DEFAULT_PERCAYA_PROGRAM_ID,
  );
  const ammProgramId = new PublicKey(
    process.env.PERCAYA_AMM_PROGRAM_ID || DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  );

  const conn = new Connection(rpcUrl, 'confirmed');
  const startBal = await conn.getBalance(admin.publicKey);
  console.log(
    `[seed-devnet] Admin ${admin.publicKey.toBase58()} balance: ${(startBal / 1e9).toFixed(4)} SOL`,
  );

  // Cache standard rent-exempt minimums once (cuts RPC calls drastically)
  const rent82 = await conn.getMinimumBalanceForRentExemption(82);
  await sleep(600);
  const rent165 = await conn.getMinimumBalanceForRentExemption(165);
  await sleep(600);
  const rent170 = await conn.getMinimumBalanceForRentExemption(170);
  await sleep(600);
  const rent174 = await conn.getMinimumBalanceForRentExemption(174);

  // 1. Initialize GlobalConfig
  const [configPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.config().map((b) => Buffer.from(b)),
    percayaProgramId,
  );

  if (!(await conn.getAccountInfo(configPda))) {
    const paramsBuf = Buffer.alloc(8 + 8 + 4 * 8 + 2 * 6);
    let o = 0;
    paramsBuf.writeBigUInt64LE(50_000_000n, o); // min_bond: 0.05 SOL
    o += 8;
    paramsBuf.writeBigUInt64LE(10_000_000n, o); // min_pool: 0.01 SOL
    o += 8;
    for (const u32Val of [60, 600, 600, 120, 1800, 45, 600, 300]) {
      paramsBuf.writeUInt32LE(u32Val, o);
      o += 4;
    }
    for (const u16Val of [100, 9000, 500, 200, 200, 10]) {
      paramsBuf.writeUInt16LE(u16Val, o);
      o += 2;
    }
    const initCfgIx = new TransactionInstruction({
      programId: percayaProgramId,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        ixDisc('initialize_config'),
        paramsBuf,
        admin.publicKey.toBuffer(),
        admin.publicKey.toBuffer(),
      ]),
    });
    const sig = await sendAndConfirm(conn, admin, [], [initCfgIx]);
    console.log(`[seed-devnet] GlobalConfig initialized (${configPda.toBase58()}) tx: ${sig}`);
  } else {
    console.log(`[seed-devnet] GlobalConfig already exists (${configPda.toBase58()})`);
  }

  // 2. Seed 3 SPL tokens + AMM pools + AllowedToken PDAs (2 batched txs per token)
  const tokenSpecs = [
    { symbol: 'tBONK', name: 'Testnet Bonk', initialSol: 0.7, initialTokens: 700_000n * 1_000_000n },
    { symbol: 'tWIF', name: 'Testnet dogwifhat', initialSol: 0.6, initialTokens: 600_000n * 1_000_000n },
    { symbol: 'tSKR', name: 'Testnet Seeker Ecosystem', initialSol: 0.6, initialTokens: 1_200_000n * 1_000_000n },
  ];

  const seededTokens: Array<{
    symbol: string;
    name: string;
    decimals: number;
    mint: string;
    ammPool: string;
    ammSolVault: string;
    ammTokenVault: string;
    allowedTokenPda: string;
    adminTokenAccount: string;
    initialSol: number;
  }> = [];

  for (const spec of tokenSpecs) {
    const mint = Keypair.generate();
    const [ammPool] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.ammPool(mint.publicKey.toBytes()).map((b) => Buffer.from(b)),
      ammProgramId,
    );
    const [ammSolVault] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
      ammProgramId,
    );
    const ammTokenVault = Keypair.generate();
    const adminTokenAccount = Keypair.generate();

    // Tx A: Create Mint + Vault + Admin Token Account + MintTo (1 batched tx)
    await sendAndConfirm(conn, admin, [mint, ammTokenVault, adminTokenAccount], [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: rent82,
        space: 82,
        programId: SPL_TOKEN_ID,
      }),
      buildInitMint2Ix(mint.publicKey, admin.publicKey, 6, SPL_TOKEN_ID),
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: ammTokenVault.publicKey,
        lamports: rent165,
        space: 165,
        programId: SPL_TOKEN_ID,
      }),
      buildInitAccount3Ix(ammTokenVault.publicKey, mint.publicKey, ammPool, SPL_TOKEN_ID),
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: adminTokenAccount.publicKey,
        lamports: rent165,
        space: 165,
        programId: SPL_TOKEN_ID,
      }),
      buildInitAccount3Ix(
        adminTokenAccount.publicKey,
        mint.publicKey,
        admin.publicKey,
        SPL_TOKEN_ID,
      ),
      buildMintToIx(
        mint.publicKey,
        adminTokenAccount.publicKey,
        admin.publicKey,
        spec.initialTokens * 2n,
        SPL_TOKEN_ID,
      ),
    ]);

    // Tx B: InitializePool + RegisterToken (1 batched tx)
    const solLamports = BigInt(Math.floor(spec.initialSol * Number(LAMPORTS_PER_SOL_N)));
    const feeBuf = Buffer.alloc(2);
    feeBuf.writeUInt16LE(30, 0);
    const initPoolIx = new TransactionInstruction({
      programId: ammProgramId,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: ammPool, isSigner: false, isWritable: true },
        { pubkey: ammSolVault, isSigner: false, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: ammTokenVault.publicKey, isSigner: false, isWritable: true },
        { pubkey: adminTokenAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        ixDisc('initialize_pool'),
        feeBuf,
        Buffer.from(u64LeBytes(solLamports)),
        Buffer.from(u64LeBytes(spec.initialTokens)),
      ]),
    });

    const [allowedTokenPda] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.allowedToken(mint.publicKey.toBytes()).map((b) => Buffer.from(b)),
      percayaProgramId,
    );
    const regTokIx = new TransactionInstruction({
      programId: percayaProgramId,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: ammPool, isSigner: false, isWritable: false },
        { pubkey: allowedTokenPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([ixDisc('register_token'), Buffer.from([1])]),
    });

    const poolSig = await sendAndConfirm(conn, admin, [], [initPoolIx, regTokIx]);
    console.log(
      `[seed-devnet] Seeded $${spec.symbol}: mint=${mint.publicKey.toBase58()} pool=${ammPool.toBase58()} (${spec.initialSol} SOL) tx=${poolSig}`,
    );

    seededTokens.push({
      symbol: spec.symbol,
      name: spec.name,
      decimals: 6,
      mint: mint.publicKey.toBase58(),
      ammPool: ammPool.toBase58(),
      ammSolVault: ammSolVault.toBase58(),
      ammTokenVault: ammTokenVault.publicKey.toBase58(),
      allowedTokenPda: allowedTokenPda.toBase58(),
      adminTokenAccount: adminTokenAccount.publicKey.toBase58(),
      initialSol: spec.initialSol,
    });
  }

  // 3. Register caller + post bond + mint & verify Token-2022 NonTransferable Seeker Genesis NFT
  const [callerRecordPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.caller(admin.publicKey.toBytes()).map((b) => Buffer.from(b)),
    percayaProgramId,
  );
  const [bondVaultPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.bondVault(admin.publicKey.toBytes()).map((b) => Buffer.from(b)),
    percayaProgramId,
  );

  let genesisMintStr = '';
  let genesisRegistryStr = '';

  if (!(await conn.getAccountInfo(callerRecordPda))) {
    const genMint = Keypair.generate();
    const genTok = Keypair.generate();

    // Tx 1: Mint Token-2022 NonTransferable Genesis NFT (1 batched tx)
    await sendAndConfirm(conn, admin, [genMint, genTok], [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: genMint.publicKey,
        lamports: rent170,
        space: 170,
        programId: TOKEN_2022_ID,
      }),
      new TransactionInstruction({
        programId: TOKEN_2022_ID,
        keys: [{ pubkey: genMint.publicKey, isSigner: false, isWritable: true }],
        data: Buffer.from([32]), // InitializeNonTransferableMint
      }),
      buildInitMint2Ix(genMint.publicKey, admin.publicKey, 0, TOKEN_2022_ID),
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: genTok.publicKey,
        lamports: rent174,
        space: 174,
        programId: TOKEN_2022_ID,
      }),
      buildInitAccount3Ix(genTok.publicKey, genMint.publicKey, admin.publicKey, TOKEN_2022_ID),
      buildMintToIx(genMint.publicKey, genTok.publicKey, admin.publicKey, 1n, TOKEN_2022_ID),
    ]);

    // Tx 2: register_caller + post_bond(0.1 SOL) + verify_seeker_genesis (1 batched tx)
    const [genRegPda] = PublicKey.findProgramAddressSync(
      PDA_SEEDS.genesis(genMint.publicKey.toBytes()).map((b) => Buffer.from(b)),
      percayaProgramId,
    );
    const genSig = await sendAndConfirm(conn, admin, [], [
      new TransactionInstruction({
        programId: percayaProgramId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: callerRecordPda, isSigner: false, isWritable: true },
          { pubkey: bondVaultPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixDisc('register_caller'),
      }),
      new TransactionInstruction({
        programId: percayaProgramId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: callerRecordPda, isSigner: false, isWritable: true },
          { pubkey: bondVaultPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([ixDisc('post_bond'), Buffer.from(u64LeBytes(100_000_000n))]),
      }),
      new TransactionInstruction({
        programId: percayaProgramId,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: callerRecordPda, isSigner: false, isWritable: true },
          { pubkey: genMint.publicKey, isSigner: false, isWritable: false },
          { pubkey: genTok.publicKey, isSigner: false, isWritable: false },
          { pubkey: genRegPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixDisc('verify_seeker_genesis'),
      }),
    ]);

    genesisMintStr = genMint.publicKey.toBase58();
    genesisRegistryStr = genRegPda.toBase58();
    console.log(
      `[seed-devnet] Verified Token-2022 Seeker Genesis NFT (${genesisMintStr}) tx: ${genSig}`,
    );
  }

  const deployment = {
    cluster: 'devnet',
    rpcUrl,
    seededAt: new Date().toISOString(),
    admin: admin.publicKey.toBase58(),
    programs: {
      percaya: percayaProgramId.toBase58(),
      percayaAmm: ammProgramId.toBase58(),
    },
    configPda: configPda.toBase58(),
    demoSeekerGenesis: {
      caller: admin.publicKey.toBase58(),
      callerRecordPda: callerRecordPda.toBase58(),
      genesisMint: genesisMintStr,
      genesisRegistryPda: genesisRegistryStr,
    },
    tokens: seededTokens,
  };

  fs.writeFileSync(DEPLOYMENT_OUT, JSON.stringify(deployment, null, 2));
  const endBal = await conn.getBalance(admin.publicKey);
  console.log(`[seed-devnet] Wrote ${DEPLOYMENT_OUT}`);
  console.log(`[seed-devnet] Remaining admin balance: ${(endBal / 1e9).toFixed(4)} SOL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
