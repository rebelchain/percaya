import { LAMPORTS_PER_SOL_N, PDA_SEEDS, u64LeBytes, type CallDetail } from '@percaya/core';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  anchorIxDiscriminator,
  encodeCheckpointIxData,
  encodeClaimIxData,
  encodeOpenCallIxData,
  encodeSellIxData,
  getProgramIds,
} from './chain.ts';
import { loadDevnetDeployment } from './devnet-sync.ts';

const SPL_TOKEN_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

async function compileV0Base64(
  conn: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

/**
 * Builds an atomic Open Call transaction on Devnet.
 * If the caller has no CallerRecord or bond < min_bond (0.05 SOL on Devnet),
 * bundles register_caller + post_bond + open_call in ONE transaction and returns
 * an explicit Bond vs Stake breakdown for transparent UX.
 */
export async function buildOpenCallTx(params: {
  rpcUrl: string;
  callerBase58: string;
  tokenSymbol: string;
  stakeSol: number;
  windowMin: number;
  tpPct: number;
  slPct: number;
  maxHoldMin: number;
  sharePct: number;
  thesis: string;
}) {
  const dep = loadDevnetDeployment();
  if (!dep) throw new Error('Devnet deployment config missing');

  const tok = dep.tokens.find(
    (t) => t.symbol.toLowerCase() === params.tokenSymbol.toLowerCase(),
  );
  if (!tok) throw new Error(`Token $${params.tokenSymbol} not registered on Devnet`);

  const conn = new Connection(params.rpcUrl, 'confirmed');
  const { percayaProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);
  const caller = new PublicKey(params.callerBase58);
  const configPda = new PublicKey(dep.configPda);

  const cfgAcct = await conn.getAccountInfo(configPda);
  if (!cfgAcct) throw new Error('GlobalConfig PDA not found on Devnet');
  const nextCallId = Number(cfgAcct.data.readBigUInt64LE(136));
  const minBondLamports = cfgAcct.data.readBigUInt64LE(146);

  const [callerRecord] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.caller(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const [bondVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.bondVault(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  const ixs: TransactionInstruction[] = [];
  const recAcct = await conn.getAccountInfo(callerRecord);
  let bondNeededLamports = 0n;
  let needsRegister = false;

  if (!recAcct) {
    needsRegister = true;
    bondNeededLamports = minBondLamports;
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: caller, isSigner: true, isWritable: true },
          { pubkey: callerRecord, isSigner: false, isWritable: true },
          { pubkey: bondVault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: anchorIxDiscriminator('register_caller'),
      }),
    );
  } else {
    const currentBond = recAcct.data.readBigUInt64LE(73);
    if (currentBond < minBondLamports) {
      bondNeededLamports = minBondLamports - currentBond;
    }
  }

  if (bondNeededLamports > 0n) {
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: caller, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: callerRecord, isSigner: false, isWritable: true },
          { pubkey: bondVault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          anchorIxDiscriminator('post_bond'),
          Buffer.from(u64LeBytes(bondNeededLamports)),
        ]),
      }),
    );
  }

  const stakeLamports = BigInt(Math.floor(params.stakeSol * Number(LAMPORTS_PER_SOL_N)));
  if (stakeLamports <= 0n) throw new Error('Stake must be > 0 SOL');

  const [allowedToken] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.allowedToken(new PublicKey(tok.mint).toBytes()).map((b) => Buffer.from(b)),
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
    PDA_SEEDS.position(nextCallId, caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  ixs.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: caller, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: callerRecord, isSigner: false, isWritable: true },
        { pubkey: allowedToken, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(tok.ammPool), isSigner: false, isWritable: false },
        { pubkey: callPool, isSigner: false, isWritable: true },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: callerPos, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeOpenCallIxData({
        windowDuration: Math.max(60, Math.round(params.windowMin * 60)),
        takeProfitBps: Math.max(0, Math.round(params.tpPct * 100)),
        stopLossBps: Math.min(9000, Math.max(100, Math.round(params.slPct * 100))),
        maxHoldDuration: Math.max(120, Math.round(params.maxHoldMin * 60)),
        shareBps: Math.min(500, Math.max(0, Math.round(params.sharePct * 100))),
        stakeLamports,
        thesis: params.thesis.slice(0, 280),
      }),
    }),
  );

  const transaction = await compileV0Base64(conn, caller, ixs);
  return {
    transaction,
    callId: nextCallId,
    needsRegister,
    bondLamports: bondNeededLamports.toString(),
    stakeLamports: stakeLamports.toString(),
    totalLamports: (bondNeededLamports + stakeLamports).toString(),
  };
}

export async function buildCheckpointTx(rpcUrl: string, signerBase58: string, call: CallDetail) {
  const conn = new Connection(rpcUrl, 'confirmed');
  const { percayaProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);
  const signer = new PublicKey(signerBase58);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(call.pda), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(call.rules.ammPool), isSigner: false, isWritable: false },
    ],
    data: encodeCheckpointIxData(),
  });
  return { transaction: await compileV0Base64(conn, signer, [ix]) };
}

export async function buildSellTx(rpcUrl: string, keeperBase58: string, call: CallDetail) {
  const conn = new Connection(rpcUrl, 'confirmed');
  const { percayaProgramId, ammProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);
  const ammPk = new PublicKey(ammProgramId);
  const keeper = new PublicKey(keeperBase58);
  const callPool = new PublicKey(call.pda);
  const ammPool = new PublicKey(call.rules.ammPool);

  const tokAccts = await conn.getTokenAccountsByOwner(callPool, {
    mint: new PublicKey(call.token.mint),
  });
  if (tokAccts.value.length === 0) {
    throw new Error('Call token vault not found on chain');
  }
  const callTokenVault = tokAccts.value[0].pubkey;

  const ammInfo = await conn.getAccountInfo(ammPool);
  if (!ammInfo) throw new Error('AmmPool not found');
  const ammTokenVault = new PublicKey(ammInfo.data.subarray(72, 104));

  const [solVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [callerRecord] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.caller(new PublicKey(call.caller).toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const [ammSolVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.ammSolVault(ammPool.toBytes()).map((b) => Buffer.from(b)),
    ammPk,
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keeper, isSigner: true, isWritable: true },
      { pubkey: callPool, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: callerRecord, isSigner: false, isWritable: true },
      { pubkey: ammPool, isSigner: false, isWritable: true },
      { pubkey: ammSolVault, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(call.token.mint), isSigner: false, isWritable: false },
      { pubkey: ammTokenVault, isSigner: false, isWritable: true },
      { pubkey: callTokenVault, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
      { pubkey: ammPk, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeSellIxData(),
  });
  return { transaction: await compileV0Base64(conn, keeper, [ix]) };
}

export async function buildClaimTx(rpcUrl: string, participantBase58: string, call: CallDetail) {
  const conn = new Connection(rpcUrl, 'confirmed');
  const { percayaProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);
  const participant = new PublicKey(participantBase58);
  const callPool = new PublicKey(call.pda);

  const [solVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.solVault(call.callId).map((b) => Buffer.from(b)),
    programId,
  );
  const [position] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.position(call.callId, participant.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: callPool, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(call.token.mint), isSigner: false, isWritable: false },
      { pubkey: callPool, isSigner: false, isWritable: true },
      { pubkey: participant, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeClaimIxData(),
  });
  return { transaction: await compileV0Base64(conn, participant, [ix]) };
}

/**
 * Builds a single atomic VersionedTransaction that:
 *  1. Mints a 1-per-device Token-2022 `NonTransferable` Devnet Seeker Genesis NFT (signed by `genesisAuthority`)
 *  2. Registers `CallerRecord` if not yet initialized
 *  3. Binds the NFT permanently to `GenesisRegistry` PDA (`[b"genesis", genesis_mint]`) via `verify_seeker_genesis`
 *
 * Partially signed by `[genesisAuthority, genMint, genTok]` so the caller signs once in MWA 2.0.
 */
export async function buildVerifySeekerGenesisTx(params: {
  rpcUrl: string;
  callerBase58: string;
  genesisAuthority: Keypair;
}): Promise<{
  transaction: string;
  genesisMint: string;
  genesisRegistry: string;
  needsRegister: boolean;
}> {
  const dep = loadDevnetDeployment();
  const configPda = new PublicKey(
    dep?.configPda ?? 'F559AB2MjAZModvfDw9oqqpy8gNEuS3AFYZbFTii8aa7',
  );
  const { percayaProgramId } = getProgramIds();
  const programId = new PublicKey(percayaProgramId);
  const caller = new PublicKey(params.callerBase58);
  const conn = new Connection(params.rpcUrl, 'confirmed');

  const [callerRecord] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.caller(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );
  const [bondVault] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.bondVault(caller.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  const recAcct = await conn.getAccountInfo(callerRecord);
  if (recAcct && recAcct.data[72] === 1) {
    throw new Error('This wallet already has a verified Seeker Genesis Token bound on-chain');
  }
  const needsRegister = !recAcct;

  const [rent170, rent174, latest] = await Promise.all([
    conn.getMinimumBalanceForRentExemption(170),
    conn.getMinimumBalanceForRentExemption(174),
    conn.getLatestBlockhash('confirmed'),
  ]);

  const genMint = Keypair.generate();
  const genTok = Keypair.generate();
  const [genRegPda] = PublicKey.findProgramAddressSync(
    PDA_SEEDS.genesis(genMint.publicKey.toBytes()).map((b) => Buffer.from(b)),
    programId,
  );

  const initMintData = Buffer.alloc(35);
  initMintData[0] = 20; // InitializeMint2
  initMintData[1] = 0; // decimals = 0
  params.genesisAuthority.publicKey.toBuffer().copy(initMintData, 2);
  initMintData[34] = 0;

  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: caller,
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
    new TransactionInstruction({
      programId: TOKEN_2022_ID,
      keys: [{ pubkey: genMint.publicKey, isSigner: false, isWritable: true }],
      data: initMintData,
    }),
    SystemProgram.createAccount({
      fromPubkey: caller,
      newAccountPubkey: genTok.publicKey,
      lamports: rent174,
      space: 174,
      programId: TOKEN_2022_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_2022_ID,
      keys: [
        { pubkey: genTok.publicKey, isSigner: false, isWritable: true },
        { pubkey: genMint.publicKey, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([18]), caller.toBuffer()]), // InitializeAccount3
    }),
    new TransactionInstruction({
      programId: TOKEN_2022_ID,
      keys: [
        { pubkey: genMint.publicKey, isSigner: false, isWritable: true },
        { pubkey: genTok.publicKey, isSigner: false, isWritable: true },
        { pubkey: params.genesisAuthority.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([7]), Buffer.from(u64LeBytes(1n))]), // MintTo(1)
    }),
  ];

  if (needsRegister) {
    ixs.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: caller, isSigner: true, isWritable: true },
          { pubkey: callerRecord, isSigner: false, isWritable: true },
          { pubkey: bondVault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: anchorIxDiscriminator('register_caller'),
      }),
    );
  }

  ixs.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: caller, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: callerRecord, isSigner: false, isWritable: true },
        { pubkey: genMint.publicKey, isSigner: false, isWritable: false },
        { pubkey: genTok.publicKey, isSigner: false, isWritable: false },
        { pubkey: genRegPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: anchorIxDiscriminator('verify_seeker_genesis'),
    }),
  );

  const msg = new TransactionMessage({
    payerKey: caller,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([params.genesisAuthority, genMint, genTok]);

  return {
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    genesisMint: genMint.publicKey.toBase58(),
    genesisRegistry: genRegPda.toBase58(),
    needsRegister,
  };
}
