use anchor_lang::{
    prelude::{Clock, Pubkey, Rent},
    solana_program::{
        instruction::{AccountMeta, Instruction},
        system_instruction, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use percaya::{
    CallPool, CallState, CallerRecord, OpenCallArgs, ProtocolParams, ALLOWED_TOKEN_SEED,
    BOND_VAULT_SEED, CALLER_SEED, CALL_SEED, CONFIG_SEED, GENESIS_SEED, POSITION_SEED,
    SOL_VAULT_SEED,
};
use percaya_amm::{
    spl_compat::{SPL_TOKEN_ID, TOKEN_2022_ID},
    AMM_POOL_SEED, AMM_SOL_SEED,
};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

fn default_demo_params() -> ProtocolParams {
    ProtocolParams {
        min_bond: 200_000_000,   // 0.20 SOL
        min_pool: 50_000_000,    // 0.05 SOL
        min_window: 60,          // 1m
        max_window: 3600,        // 1h
        buy_grace: 600,          // 10m
        min_hold: 120,           // 2m
        max_hold: 7200,          // 2h
        checkpoint_gap: 60,      // 1m
        split_grace: 600,        // 10m
        bond_cooldown: 300,      // 5m
        min_stop_loss_bps: 100,  // 1%
        max_stop_loss_bps: 9000, // 90%
        min_caller_bps: 500,     // 5%
        max_impact_bps: 200,     // 2%
        sell_tolerance_bps: 200, // 2%
        keeper_bps: 10,          // 0.1%
    }
}

fn send_ixs(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<(), String> {
    svm.expire_blockhash();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let mut signers: Vec<&Keypair> = vec![payer];
    for s in extra_signers {
        if s.pubkey() != payer.pubkey() {
            signers.push(s);
        }
    }
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .map_err(|e| format!("sign err: {e:?}"))?;
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err))
}

fn clone_kp(kp: &Keypair) -> Keypair {
    let secret: [u8; 32] = kp.to_bytes()[0..32].try_into().unwrap();
    Keypair::new_from_array(secret)
}

fn rent_min(space: usize) -> u64 {
    Rent::default().minimum_balance(space)
}

fn warp_seconds(svm: &mut LiteSVM, secs: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp += secs;
    clock.slot += (secs.max(1) as u64) * 2;
    svm.set_sysvar(&clock);
}

fn create_spl_mint(svm: &mut LiteSVM, payer: &Keypair, mint_auth: &Pubkey, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let lamports = rent_min(82);
    let create_ix =
        system_instruction::create_account(&payer.pubkey(), &mint.pubkey(), lamports, 82, &SPL_TOKEN_ID);
    let mut init_data = vec![20u8, decimals]; // InitializeMint2
    init_data.extend_from_slice(mint_auth.as_ref());
    init_data.push(0u8);
    let init_ix = Instruction {
        program_id: SPL_TOKEN_ID,
        accounts: vec![AccountMeta::new(mint.pubkey(), false)],
        data: init_data,
    };
    send_ixs(svm, payer, &[&mint], &[create_ix, init_ix]).unwrap();
    mint.pubkey()
}

fn create_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    token_program: &Pubkey,
    space: usize,
) -> Pubkey {
    let acct = Keypair::new();
    let lamports = rent_min(space);
    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &acct.pubkey(),
        lamports,
        space as u64,
        token_program,
    );
    let mut init_data = vec![18u8]; // InitializeAccount3
    init_data.extend_from_slice(owner.as_ref());
    let init_ix = Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(acct.pubkey(), false),
            AccountMeta::new_readonly(*mint, false),
        ],
        data: init_data,
    };
    send_ixs(svm, payer, &[&acct], &[create_ix, init_ix]).unwrap();
    acct.pubkey()
}

fn mint_tokens_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    mint_auth: &Keypair,
    amount: u64,
    token_program: &Pubkey,
) {
    let mut data = vec![7u8]; // MintTo
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(mint_auth.pubkey(), true),
        ],
        data,
    };
    send_ixs(svm, payer, &[mint_auth], &[ix]).unwrap();
}

/// Creates a real Token-2022 NonTransferable Seeker Genesis NFT (170-byte Mint + 174-byte Account)
fn mint_seeker_genesis_nft(
    svm: &mut LiteSVM,
    payer: &Keypair,
    genesis_auth: &Keypair,
    recipient: &Pubkey,
) -> (Pubkey, Pubkey) {
    let mint = Keypair::new();
    let mint_space = 170usize; // 165 base + 1 AccountType + 4 TLV header (NonTransferable = 9, len = 0)
    let create_mint_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent_min(mint_space),
        mint_space as u64,
        &TOKEN_2022_ID,
    );
    let non_transferable_ix = Instruction {
        program_id: TOKEN_2022_ID,
        accounts: vec![AccountMeta::new(mint.pubkey(), false)],
        data: vec![32u8], // TokenInstruction::InitializeNonTransferableMint
    };
    let mut init_mint_data = vec![20u8, 0u8]; // InitializeMint2, decimals = 0
    init_mint_data.extend_from_slice(genesis_auth.pubkey().as_ref());
    init_mint_data.push(0u8);
    let init_mint_ix = Instruction {
        program_id: TOKEN_2022_ID,
        accounts: vec![AccountMeta::new(mint.pubkey(), false)],
        data: init_mint_data,
    };
    send_ixs(
        svm,
        payer,
        &[&mint],
        &[create_mint_ix, non_transferable_ix, init_mint_ix],
    )
    .unwrap();

    // 174 bytes = 165 base + 1 AccountType + 4 ImmutableOwner + 4 NonTransferableAccount
    let tok_acct = create_token_account(svm, payer, &mint.pubkey(), recipient, &TOKEN_2022_ID, 174);
    mint_tokens_to(svm, payer, &mint.pubkey(), &tok_acct, genesis_auth, 1, &TOKEN_2022_ID);
    (mint.pubkey(), tok_acct)
}

struct TestEnv {
    svm: LiteSVM,
    admin: Keypair,
    treasury: Keypair,
    genesis_auth: Keypair,
    config_pda: Pubkey,
    token_mint: Pubkey,
    amm_pool: Pubkey,
    amm_sol_vault: Pubkey,
    amm_token_vault: Pubkey,
    allowed_token: Pubkey,
}

fn setup_env() -> TestEnv {
    let mut svm = LiteSVM::new();
    let amm_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/percaya_amm.so"
    ))
    .expect("target/deploy/percaya_amm.so missing - run anchor build first");
    let percaya_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/percaya.so"
    ))
    .expect("target/deploy/percaya.so missing - run anchor build first");
    svm.add_program(percaya_amm::ID, &amm_bytes).unwrap();
    svm.add_program(percaya::ID, &percaya_bytes).unwrap();

    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = 1_795_000_000;
    svm.set_sysvar(&clock);

    let admin = Keypair::new();
    let treasury = Keypair::new();
    let genesis_auth = Keypair::new();
    svm.airdrop(&admin.pubkey(), 20_000 * LAMPORTS_PER_SOL).unwrap();
    svm.airdrop(&treasury.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &percaya::ID);
    let init_cfg_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::InitializeConfig {
            params: default_demo_params(),
            genesis_authority: genesis_auth.pubkey(),
            treasury: treasury.pubkey(),
        }
        .data(),
        percaya::accounts::InitializeConfig {
            admin: admin.pubkey(),
            config: config_pda,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut svm, &admin, &[], &[init_cfg_ix]).unwrap();

    // Create SPL token & deep AMM pool (10,000 SOL : 10,000,000 tBONK -> 2% impact cap ~ 204 SOL)
    let token_mint = create_spl_mint(&mut svm, &admin, &admin.pubkey(), 6);
    let (amm_pool, _) =
        Pubkey::find_program_address(&[AMM_POOL_SEED, token_mint.as_ref()], &percaya_amm::ID);
    let (amm_sol_vault, _) =
        Pubkey::find_program_address(&[AMM_SOL_SEED, amm_pool.as_ref()], &percaya_amm::ID);
    let amm_token_vault =
        create_token_account(&mut svm, &admin, &token_mint, &amm_pool, &SPL_TOKEN_ID, 165);
    let admin_token_acct = create_token_account(
        &mut svm,
        &admin,
        &token_mint,
        &admin.pubkey(),
        &SPL_TOKEN_ID,
        165,
    );
    let initial_tokens = 10_000_000_000_000u64;
    mint_tokens_to(
        &mut svm,
        &admin,
        &token_mint,
        &admin_token_acct,
        &admin,
        initial_tokens * 2,
        &SPL_TOKEN_ID,
    );

    let init_pool_ix = Instruction::new_with_bytes(
        percaya_amm::ID,
        &percaya_amm::instruction::InitializePool {
            fee_bps: 30,
            initial_sol: 10_000 * LAMPORTS_PER_SOL,
            initial_tokens,
        }
        .data(),
        percaya_amm::accounts::InitializePool {
            authority: admin.pubkey(),
            amm_pool,
            amm_sol_vault,
            token_mint,
            token_vault: amm_token_vault,
            authority_token_account: admin_token_acct,
            token_program: SPL_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut svm, &admin, &[], &[init_pool_ix]).unwrap();

    let (allowed_token, _) =
        Pubkey::find_program_address(&[ALLOWED_TOKEN_SEED, token_mint.as_ref()], &percaya::ID);
    let reg_tok_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::RegisterToken { allowed: true }.data(),
        percaya::accounts::RegisterToken {
            admin: admin.pubkey(),
            config: config_pda,
            token_mint,
            amm_pool,
            allowed_token,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut svm, &admin, &[], &[reg_tok_ix]).unwrap();

    TestEnv {
        svm,
        admin,
        treasury,
        genesis_auth,
        config_pda,
        token_mint,
        amm_pool,
        amm_sol_vault,
        amm_token_vault,
        allowed_token,
    }
}

fn fetch_anchor<T: AccountDeserialize>(svm: &LiteSVM, pubkey: &Pubkey) -> T {
    let acct = svm.get_account(pubkey).expect("account missing");
    let mut slice: &[u8] = &acct.data;
    T::try_deserialize(&mut slice).expect("deserialize failed")
}

fn register_and_bond_caller(env: &mut TestEnv, caller: &Keypair, bond_lamports: u64) -> (Pubkey, Pubkey) {
    let (caller_record, _) =
        Pubkey::find_program_address(&[CALLER_SEED, caller.pubkey().as_ref()], &percaya::ID);
    let (bond_vault, _) =
        Pubkey::find_program_address(&[BOND_VAULT_SEED, caller.pubkey().as_ref()], &percaya::ID);
    let reg_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::RegisterCaller {}.data(),
        percaya::accounts::RegisterCaller {
            caller: caller.pubkey(),
            caller_record,
            bond_vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let bond_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::PostBond {
            amount: bond_lamports,
        }
        .data(),
        percaya::accounts::PostBond {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            bond_vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, caller, &[], &[reg_ix, bond_ix]).unwrap();
    (caller_record, bond_vault)
}

#[test]
fn test_full_pooled_call_profit_symmetric_returns_and_dust_sweep() {
    let mut env = setup_env();
    let caller = Keypair::new();
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    let user_c = Keypair::new();
    let keeper = Keypair::new();
    let whale = Keypair::new();

    for w in [&caller, &user_a, &user_b, &user_c, &keeper] {
        env.svm.airdrop(&w.pubkey(), 200 * LAMPORTS_PER_SOL).unwrap();
    }
    env.svm
        .airdrop(&whale.pubkey(), 5_000 * LAMPORTS_PER_SOL)
        .unwrap();

    // Caller posts 50 SOL bond (Tier 0 = 2x = 100 SOL cap, 5% share)
    let (caller_record, _) = register_and_bond_caller(&mut env, &caller, 50 * LAMPORTS_PER_SOL);

    let call_id = 1u64;
    let (call_pool, _) =
        Pubkey::find_program_address(&[CALL_SEED, &call_id.to_le_bytes()], &percaya::ID);
    let (sol_vault, _) =
        Pubkey::find_program_address(&[SOL_VAULT_SEED, &call_id.to_le_bytes()], &percaya::ID);
    let (caller_pos, _) = Pubkey::find_program_address(
        &[
            POSITION_SEED,
            &call_id.to_le_bytes(),
            caller.pubkey().as_ref(),
        ],
        &percaya::ID,
    );

    let open_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::OpenCall {
            args: OpenCallArgs {
                window_duration: 120,
                take_profit_bps: 2000, // +20%
                stop_loss_bps: 1500,   // -15%
                max_hold_duration: 600,
                share_bps: 500, // 5% Tier 0 max
                stake_lamports: 10 * LAMPORTS_PER_SOL,
                thesis: "High-conviction entry on tBONK".to_string(),
            },
        }
        .data(),
        percaya::accounts::OpenCall {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            call_pool,
            sol_vault,
            caller_position: caller_pos,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[open_ix]).unwrap();

    // Caller cannot withdraw during join window
    let caller_withdraw_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Withdraw {
            amount: LAMPORTS_PER_SOL,
        }
        .data(),
        percaya::accounts::Withdraw {
            participant: caller.pubkey(),
            call_pool,
            sol_vault,
            position: caller_pos,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(
        send_ixs(&mut env.svm, &caller, &[], &[caller_withdraw_ix]).is_err(),
        "caller must never withdraw"
    );

    // Joiners deposit: A=30 SOL, B=40 SOL, C=20 SOL -> total = 100 SOL
    for (u, amt) in [
        (&user_a, 30 * LAMPORTS_PER_SOL),
        (&user_b, 40 * LAMPORTS_PER_SOL),
        (&user_c, 20 * LAMPORTS_PER_SOL),
    ] {
        let (pos, _) = Pubkey::find_program_address(
            &[POSITION_SEED, &call_id.to_le_bytes(), u.pubkey().as_ref()],
            &percaya::ID,
        );
        let init_pos = Instruction::new_with_bytes(
            percaya::ID,
            &percaya::instruction::InitPosition {}.data(),
            percaya::accounts::InitPosition {
                participant: u.pubkey(),
                call_pool,
                position: pos,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let dep_ix = Instruction::new_with_bytes(
            percaya::ID,
            &percaya::instruction::Deposit { amount: amt }.data(),
            percaya::accounts::Deposit {
                participant: u.pubkey(),
                call_pool,
                sol_vault,
                position: pos,
                amm_pool: env.amm_pool,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send_ixs(&mut env.svm, u, &[], &[init_pos, dep_ix]).unwrap();
    }

    // Create call_token_vault owned by call_pool PDA, warp past window_end, execute pooled buy()
    let call_token_vault = create_token_account(
        &mut env.svm,
        &caller,
        &env.token_mint,
        &call_pool,
        &SPL_TOKEN_ID,
        165,
    );
    warp_seconds(&mut env.svm, 125);

    let buy_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Buy { min_tokens_out: 1 }.data(),
        percaya::accounts::BuyPool {
            caller: caller.pubkey(),
            call_pool,
            sol_vault,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            amm_token_vault: env.amm_token_vault,
            call_token_vault,
            token_program: SPL_TOKEN_ID,
            amm_program: percaya_amm::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[buy_ix]).unwrap();

    let call_after_buy: CallPool = fetch_anchor(&env.svm, &call_pool);
    assert_eq!(call_after_buy.state, CallState::Holding);
    assert!(call_after_buy.tokens_bought > 0);

    // Whale buys 1,600 SOL of tBONK (~+33% spot move -> well above +20% TP!)
    let whale_tok = create_token_account(
        &mut env.svm,
        &whale,
        &env.token_mint,
        &whale.pubkey(),
        &SPL_TOKEN_ID,
        165,
    );
    let pump_ix = Instruction::new_with_bytes(
        percaya_amm::ID,
        &percaya_amm::instruction::SwapExactSolForTokens {
            sol_in: 1_600 * LAMPORTS_PER_SOL,
            min_tokens_out: 1,
        }
        .data(),
        percaya_amm::accounts::SwapExactSolForTokens {
            payer: whale.pubkey(),
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            token_vault: env.amm_token_vault,
            user_token_out: whale_tok,
            token_program: SPL_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &whale, &[], &[pump_ix]).unwrap();

    // Record Checkpoint 1 — immediate sell MUST fail (single-block push protection!)
    let cp_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Checkpoint {}.data(),
        percaya::accounts::RecordCheckpoint {
            call_pool,
            amm_pool: env.amm_pool,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &keeper, &[], &[cp_ix.clone()]).unwrap();

    let sell_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Sell {}.data(),
        percaya::accounts::SellPool {
            keeper: keeper.pubkey(),
            call_pool,
            sol_vault,
            caller_record,
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            amm_token_vault: env.amm_token_vault,
            call_token_vault,
            token_program: SPL_TOKEN_ID,
            amm_program: percaya_amm::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(
        send_ixs(&mut env.svm, &keeper, &[], &[sell_ix.clone()]).is_err(),
        "single checkpoint must never unlock sell()"
    );

    // Warp 60s (checkpoint_gap), record Checkpoint 2, then Keeper executes sell()
    warp_seconds(&mut env.svm, 60);
    send_ixs(&mut env.svm, &keeper, &[], &[cp_ix]).unwrap();

    let keeper_before = env.svm.get_account(&keeper.pubkey()).unwrap().lamports;
    send_ixs(&mut env.svm, &keeper, &[], &[sell_ix]).unwrap();
    let keeper_after = env.svm.get_account(&keeper.pubkey()).unwrap().lamports;

    let settled: CallPool = fetch_anchor(&env.svm, &call_pool);
    assert_eq!(settled.state, CallState::Settled);
    assert_eq!(settled.settle_reason, 1); // Take-Profit
    assert!(settled.net_return_bps > 2000);
    assert!(keeper_after > keeper_before); // Earned 0.1% keeper reward net of tiny tx fee

    // All 4 participants claim; verify symmetric bps returns and zero stranded dust
    let mut received_pct_bps = Vec::new();
    for (u, dep) in [
        (&user_a, 30 * LAMPORTS_PER_SOL),
        (&user_b, 40 * LAMPORTS_PER_SOL),
        (&caller, 10 * LAMPORTS_PER_SOL),
        (&user_c, 20 * LAMPORTS_PER_SOL),
    ] {
        let (pos, _) = Pubkey::find_program_address(
            &[POSITION_SEED, &call_id.to_le_bytes(), u.pubkey().as_ref()],
            &percaya::ID,
        );
        let bal_before = env.svm.get_account(&u.pubkey()).unwrap().lamports;
        let claim_ix = Instruction::new_with_bytes(
            percaya::ID,
            &percaya::instruction::Claim {}.data(),
            percaya::accounts::ClaimPosition {
                participant: u.pubkey(),
                call_pool,
                sol_vault,
                position: pos,
                token_mint: env.token_mint,
                call_token_vault,
                participant_token_account: call_token_vault,
                token_program: SPL_TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send_ixs(&mut env.svm, u, &[], &[claim_ix]).unwrap();
        let bal_after = env.svm.get_account(&u.pubkey()).unwrap().lamports;
        // Account for 5,000 lamport base tx signature fee paid by signer
        let claimed_lamports = (bal_after + 5_000) - bal_before;
        if u.pubkey() != caller.pubkey() {
            let ret_bps =
                ((claimed_lamports as i128 - dep as i128) * 10_000 / dep as i128) as i64;
            received_pct_bps.push(ret_bps);
        }
    }

    assert_eq!(received_pct_bps[0], received_pct_bps[1]);
    assert_eq!(received_pct_bps[1], received_pct_bps[2]);

    let final_call: CallPool = fetch_anchor(&env.svm, &call_pool);
    assert_eq!(final_call.claims_left, 0);
    assert_eq!(final_call.claimed_amount, final_call.payout);

    let vault_lamports = env.svm.get_account(&sol_vault).unwrap().lamports;
    assert_eq!(
        vault_lamports,
        rent_min(0),
        "zero stranded SOL dust after final claim"
    );
}

#[test]
fn test_loss_charges_zero_fee_and_stray_lamport_donation_is_harmless() {
    let mut env = setup_env();
    let caller = Keypair::new();
    let joiner = Keypair::new();
    let dumper = Keypair::new();
    let griefer = Keypair::new();

    for w in [&caller, &joiner, &dumper, &griefer] {
        env.svm.airdrop(&w.pubkey(), 200 * LAMPORTS_PER_SOL).unwrap();
    }

    // Mint tokens to dumper so they can crash price below stop-loss
    let dumper_tok = create_token_account(
        &mut env.svm,
        &dumper,
        &env.token_mint,
        &dumper.pubkey(),
        &SPL_TOKEN_ID,
        165,
    );
    let admin_copy = clone_kp(&env.admin);
    mint_tokens_to(
        &mut env.svm,
        &dumper,
        &env.token_mint,
        &dumper_tok,
        &admin_copy,
        3_000_000_000_000,
        &SPL_TOKEN_ID,
    );

    let (caller_record, _) = register_and_bond_caller(&mut env, &caller, 10 * LAMPORTS_PER_SOL);
    let call_id = 1u64;
    let (call_pool, _) =
        Pubkey::find_program_address(&[CALL_SEED, &call_id.to_le_bytes()], &percaya::ID);
    let (sol_vault, _) =
        Pubkey::find_program_address(&[SOL_VAULT_SEED, &call_id.to_le_bytes()], &percaya::ID);
    let (caller_pos, _) = Pubkey::find_program_address(
        &[POSITION_SEED, &call_id.to_le_bytes(), caller.pubkey().as_ref()],
        &percaya::ID,
    );

    let open_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::OpenCall {
            args: OpenCallArgs {
                window_duration: 60,
                take_profit_bps: 3000,
                stop_loss_bps: 1500, // -15%
                max_hold_duration: 600,
                share_bps: 500,
                stake_lamports: LAMPORTS_PER_SOL,
                thesis: "Testing loss symmetry".to_string(),
            },
        }
        .data(),
        percaya::accounts::OpenCall {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            call_pool,
            sol_vault,
            caller_position: caller_pos,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[open_ix]).unwrap();

    let (joiner_pos, _) = Pubkey::find_program_address(
        &[POSITION_SEED, &call_id.to_le_bytes(), joiner.pubkey().as_ref()],
        &percaya::ID,
    );
    let init_pos = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::InitPosition {}.data(),
        percaya::accounts::InitPosition {
            participant: joiner.pubkey(),
            call_pool,
            position: joiner_pos,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let dep_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Deposit {
            amount: 9 * LAMPORTS_PER_SOL,
        }
        .data(),
        percaya::accounts::Deposit {
            participant: joiner.pubkey(),
            call_pool,
            sol_vault,
            position: joiner_pos,
            amm_pool: env.amm_pool,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[init_pos, dep_ix]).unwrap();

    // Griefer sends unsolicited 0.333 SOL directly to sol_vault via system_program::transfer
    let grief_ix =
        system_instruction::transfer(&griefer.pubkey(), &sol_vault, 333_333_333);
    send_ixs(&mut env.svm, &griefer, &[], &[grief_ix]).unwrap();

    let call_token_vault = create_token_account(
        &mut env.svm,
        &caller,
        &env.token_mint,
        &call_pool,
        &SPL_TOKEN_ID,
        165,
    );
    warp_seconds(&mut env.svm, 65);
    let buy_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Buy { min_tokens_out: 1 }.data(),
        percaya::accounts::BuyPool {
            caller: caller.pubkey(),
            call_pool,
            sol_vault,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            amm_token_vault: env.amm_token_vault,
            call_token_vault,
            token_program: SPL_TOKEN_ID,
            amm_program: percaya_amm::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[buy_ix]).unwrap();

    // Dumper sells tokens to crash price > 25% below entry
    let dump_ix = Instruction::new_with_bytes(
        percaya_amm::ID,
        &percaya_amm::instruction::SwapExactTokensForSol {
            token_in: 2_000_000_000_000,
            min_sol_out: 1,
        }
        .data(),
        percaya_amm::accounts::SwapExactTokensForSol {
            authority: dumper.pubkey(),
            sol_recipient: dumper.pubkey(),
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            token_vault: env.amm_token_vault,
            user_token_in: dumper_tok,
            token_program: SPL_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &dumper, &[], &[dump_ix]).unwrap();

    let cp_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Checkpoint {}.data(),
        percaya::accounts::RecordCheckpoint {
            call_pool,
            amm_pool: env.amm_pool,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[cp_ix.clone()]).unwrap();
    warp_seconds(&mut env.svm, 60);
    send_ixs(&mut env.svm, &joiner, &[], &[cp_ix]).unwrap();

    let sell_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Sell {}.data(),
        percaya::accounts::SellPool {
            keeper: joiner.pubkey(),
            call_pool,
            sol_vault,
            caller_record,
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            amm_token_vault: env.amm_token_vault,
            call_token_vault,
            token_program: SPL_TOKEN_ID,
            amm_program: percaya_amm::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[sell_ix]).unwrap();

    let settled: CallPool = fetch_anchor(&env.svm, &call_pool);
    assert_eq!(settled.state, CallState::Settled);
    assert_eq!(settled.settle_reason, 2); // Stop-Loss
    assert_eq!(settled.fee, 0, "caller must earn zero fee on a loss");
    assert!(settled.net_return_bps < -1500);

    let rec: CallerRecord = fetch_anchor(&env.svm, &caller_record);
    assert_eq!(rec.settled, 1);
    assert_eq!(rec.losses, 1);
    assert_eq!(rec.sum_net_bps, settled.net_return_bps);
}

#[test]
fn test_seeker_genesis_token2022_hardware_gate_and_slash_permanence() {
    let mut env = setup_env();
    let caller = Keypair::new();
    let burner_wallet = Keypair::new();
    env.svm.airdrop(&caller.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();
    env.svm
        .airdrop(&burner_wallet.pubkey(), 100 * LAMPORTS_PER_SOL)
        .unwrap();

    let (caller_record, bond_vault) =
        register_and_bond_caller(&mut env, &caller, 2 * LAMPORTS_PER_SOL);
    let (burner_record, _) =
        register_and_bond_caller(&mut env, &burner_wallet, 2 * LAMPORTS_PER_SOL);

    // Mint real Token-2022 NonTransferable Seeker Genesis NFT to `caller`
    let genesis_auth = clone_kp(&env.genesis_auth);
    let (genesis_mint, genesis_tok_acct) =
        mint_seeker_genesis_nft(&mut env.svm, &caller, &genesis_auth, &caller.pubkey());

    let (genesis_registry, _) =
        Pubkey::find_program_address(&[GENESIS_SEED, genesis_mint.as_ref()], &percaya::ID);

    let verify_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::VerifySeekerGenesis {}.data(),
        percaya::accounts::VerifySeekerGenesis {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            genesis_mint,
            genesis_token_account: genesis_tok_acct,
            genesis_registry,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[verify_ix]).unwrap();

    let rec_verified: CallerRecord = fetch_anchor(&env.svm, &caller_record);
    assert!(rec_verified.is_seeker_verified);
    assert_eq!(rec_verified.genesis_mint, genesis_mint);

    // Burner wallet attempting to register the same `genesis_mint` MUST fail (`GenesisRegistry` already initialized)
    let burner_verify_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::VerifySeekerGenesis {}.data(),
        percaya::accounts::VerifySeekerGenesis {
            caller: burner_wallet.pubkey(),
            config: env.config_pda,
            caller_record: burner_record,
            genesis_mint,
            genesis_token_account: genesis_tok_acct,
            genesis_registry,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(
        send_ixs(&mut env.svm, &burner_wallet, &[], &[burner_verify_ix]).is_err(),
        "same Seeker Genesis hardware token must never initialize a second caller registry"
    );

    // Admin slashes caller -> sends bond to treasury, increments slashes, and taints GenesisRegistry
    let admin = clone_kp(&env.admin);
    let treasury_before = env.svm.get_account(&env.treasury.pubkey()).unwrap().lamports;
    let slash_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Slash {
            amount: LAMPORTS_PER_SOL,
            reason: "Funded burner wallet bought pre-pool".to_string(),
        }
        .data(),
        percaya::accounts::SlashCaller {
            admin: admin.pubkey(),
            config: env.config_pda,
            caller_record,
            bond_vault,
            treasury: env.treasury.pubkey(),
            genesis_registry,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &admin, &[], &[slash_ix]).unwrap();

    let treasury_after = env.svm.get_account(&env.treasury.pubkey()).unwrap().lamports;
    assert_eq!(treasury_after - treasury_before, LAMPORTS_PER_SOL);

    let rec_slashed: CallerRecord = fetch_anchor(&env.svm, &caller_record);
    assert_eq!(rec_slashed.slashes, 1);
    assert_eq!(rec_slashed.tier_limits(), (0, 2, 500));
}

#[test]
fn test_negligent_refund_and_token_split_safety_nets() {
    let mut env = setup_env();
    let caller = Keypair::new();
    let joiner = Keypair::new();
    env.svm.airdrop(&caller.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();
    env.svm.airdrop(&joiner.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();

    let (caller_record, _) = register_and_bond_caller(&mut env, &caller, 5 * LAMPORTS_PER_SOL);

    // --- Case 1: Caller misses buy_deadline -> Negligent Refund 1:1 ---
    let call_id_1 = 1u64;
    let (call_1, _) =
        Pubkey::find_program_address(&[CALL_SEED, &call_id_1.to_le_bytes()], &percaya::ID);
    let (vault_1, _) =
        Pubkey::find_program_address(&[SOL_VAULT_SEED, &call_id_1.to_le_bytes()], &percaya::ID);
    let (caller_pos_1, _) = Pubkey::find_program_address(
        &[POSITION_SEED, &call_id_1.to_le_bytes(), caller.pubkey().as_ref()],
        &percaya::ID,
    );

    let open_1 = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::OpenCall {
            args: OpenCallArgs {
                window_duration: 60,
                take_profit_bps: 2000,
                stop_loss_bps: 1000,
                max_hold_duration: 120,
                share_bps: 500,
                stake_lamports: LAMPORTS_PER_SOL,
                thesis: "Will miss deadline".to_string(),
            },
        }
        .data(),
        percaya::accounts::OpenCall {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            call_pool: call_1,
            sol_vault: vault_1,
            caller_position: caller_pos_1,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[open_1]).unwrap();

    // Warp past window (60s) + buy_grace (600s) + 10s
    warp_seconds(&mut env.svm, 670);
    let refund_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Refund {}.data(),
        percaya::accounts::RefundPool {
            call_pool: call_1,
            caller_record,
            allowed_token: env.allowed_token,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[refund_ix]).unwrap();

    let rec_after_neg: CallerRecord = fetch_anchor(&env.svm, &caller_record);
    assert_eq!(rec_after_neg.refunded, 1);
    assert_eq!(rec_after_neg.negligent, 1);

    // --- Case 2: Unsold past hold_until + split_grace -> Pro-Rata Token Split (0 fee) ---
    let call_id_2 = 2u64;
    let (call_2, _) =
        Pubkey::find_program_address(&[CALL_SEED, &call_id_2.to_le_bytes()], &percaya::ID);
    let (vault_2, _) =
        Pubkey::find_program_address(&[SOL_VAULT_SEED, &call_id_2.to_le_bytes()], &percaya::ID);
    let (caller_pos_2, _) = Pubkey::find_program_address(
        &[POSITION_SEED, &call_id_2.to_le_bytes(), caller.pubkey().as_ref()],
        &percaya::ID,
    );
    let open_2 = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::OpenCall {
            args: OpenCallArgs {
                window_duration: 60,
                take_profit_bps: 5000,
                stop_loss_bps: 1000,
                max_hold_duration: 120,
                share_bps: 500,
                stake_lamports: LAMPORTS_PER_SOL,
                thesis: "Will split tokens".to_string(),
            },
        }
        .data(),
        percaya::accounts::OpenCall {
            caller: caller.pubkey(),
            config: env.config_pda,
            caller_record,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            call_pool: call_2,
            sol_vault: vault_2,
            caller_position: caller_pos_2,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[open_2]).unwrap();

    let (joiner_pos_2, _) = Pubkey::find_program_address(
        &[POSITION_SEED, &call_id_2.to_le_bytes(), joiner.pubkey().as_ref()],
        &percaya::ID,
    );
    let init_pos_2 = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::InitPosition {}.data(),
        percaya::accounts::InitPosition {
            participant: joiner.pubkey(),
            call_pool: call_2,
            position: joiner_pos_2,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let dep_2 = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Deposit {
            amount: 3 * LAMPORTS_PER_SOL,
        }
        .data(),
        percaya::accounts::Deposit {
            participant: joiner.pubkey(),
            call_pool: call_2,
            sol_vault: vault_2,
            position: joiner_pos_2,
            amm_pool: env.amm_pool,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[init_pos_2, dep_2]).unwrap();

    let call_2_tok_vault = create_token_account(
        &mut env.svm,
        &caller,
        &env.token_mint,
        &call_2,
        &SPL_TOKEN_ID,
        165,
    );
    warp_seconds(&mut env.svm, 65);
    let buy_2 = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Buy { min_tokens_out: 1 }.data(),
        percaya::accounts::BuyPool {
            caller: caller.pubkey(),
            call_pool: call_2,
            sol_vault: vault_2,
            allowed_token: env.allowed_token,
            amm_pool: env.amm_pool,
            amm_sol_vault: env.amm_sol_vault,
            token_mint: env.token_mint,
            amm_token_vault: env.amm_token_vault,
            call_token_vault: call_2_tok_vault,
            token_program: SPL_TOKEN_ID,
            amm_program: percaya_amm::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &caller, &[], &[buy_2]).unwrap();

    // Warp past max_hold (120s) + split_grace (600s) + 10s
    warp_seconds(&mut env.svm, 730);
    let split_ix = Instruction::new_with_bytes(
        percaya::ID,
        &percaya::instruction::Split {}.data(),
        percaya::accounts::SplitPool {
            call_pool: call_2,
            caller_record,
        }
        .to_account_metas(None),
    );
    send_ixs(&mut env.svm, &joiner, &[], &[split_ix]).unwrap();

    let caller_tok = create_token_account(
        &mut env.svm,
        &caller,
        &env.token_mint,
        &caller.pubkey(),
        &SPL_TOKEN_ID,
        165,
    );
    let joiner_tok = create_token_account(
        &mut env.svm,
        &joiner,
        &env.token_mint,
        &joiner.pubkey(),
        &SPL_TOKEN_ID,
        165,
    );

    for (u, pos, tok_acct) in [
        (&caller, caller_pos_2, caller_tok),
        (&joiner, joiner_pos_2, joiner_tok),
    ] {
        let cl = Instruction::new_with_bytes(
            percaya::ID,
            &percaya::instruction::Claim {}.data(),
            percaya::accounts::ClaimPosition {
                participant: u.pubkey(),
                call_pool: call_2,
                sol_vault: vault_2,
                position: pos,
                token_mint: env.token_mint,
                call_token_vault: call_2_tok_vault,
                participant_token_account: tok_acct,
                token_program: SPL_TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send_ixs(&mut env.svm, u, &[], &[cl]).unwrap();
    }

    let vault_raw = env.svm.get_account(&call_2_tok_vault).unwrap();
    let rem_atoms = u64::from_le_bytes(vault_raw.data[64..72].try_into().unwrap());
    assert_eq!(rem_atoms, 0, "zero stranded SPL token dust after split claims");
}
