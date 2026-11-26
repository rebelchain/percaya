pub mod error;
pub mod events;
pub mod state;

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use percaya_amm::math as amm_math;
use percaya_amm::spl_compat::{parse_mint, parse_token_account, transfer_checked};
use percaya_amm::AmmPool;

pub use error::*;
pub use events::*;
pub use state::*;

declare_id!("8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6");

fn validate_protocol_params(p: &ProtocolParams) -> Result<()> {
    require!(
        p.min_bond > 0
            && p.min_pool > 0
            && p.min_window > 0
            && p.min_window <= p.max_window
            && p.buy_grace > 0
            && p.min_hold > 0
            && p.min_hold <= p.max_hold
            && p.checkpoint_gap > 0
            && p.split_grace > 0
            && p.min_stop_loss_bps >= 100
            && p.min_stop_loss_bps <= p.max_stop_loss_bps
            && p.max_stop_loss_bps <= 9000
            && p.min_caller_bps > 0
            && p.min_caller_bps <= 5000
            && p.max_impact_bps > 0
            && p.max_impact_bps <= 1000
            && p.sell_tolerance_bps > 0
            && p.sell_tolerance_bps <= 1000
            && p.keeper_bps <= MAX_KEEPER_BPS,
        PercayaError::InvalidParams
    );
    Ok(())
}

#[program]
pub mod percaya {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: ProtocolParams,
        genesis_authority: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        validate_protocol_params(&params)?;
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.pending_admin = Pubkey::default();
        cfg.treasury = treasury;
        cfg.genesis_authority = genesis_authority;
        cfg.next_call_id = 1;
        cfg.open_paused = false;
        cfg.bump = ctx.bumps.config;
        cfg.params = params;
        Ok(())
    }

    pub fn update_params(ctx: Context<AdminOnly>, params: ProtocolParams) -> Result<()> {
        validate_protocol_params(&params)?;
        ctx.accounts.config.params = params;
        Ok(())
    }

    pub fn set_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.open_paused = paused;
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), PercayaError::InvalidParams);
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            ctx.accounts.pending_admin.key() == cfg.pending_admin,
            PercayaError::UnauthorizedPendingAdmin
        );
        cfg.admin = cfg.pending_admin;
        cfg.pending_admin = Pubkey::default();
        Ok(())
    }

    pub fn register_token(ctx: Context<RegisterToken>, allowed: bool) -> Result<()> {
        require!(
            ctx.accounts.amm_pool.token_mint == ctx.accounts.token_mint.key(),
            PercayaError::PoolMintMismatch
        );
        let at = &mut ctx.accounts.allowed_token;
        at.token_mint = ctx.accounts.token_mint.key();
        at.amm_pool = ctx.accounts.amm_pool.key();
        at.allowed = allowed;
        at.bump = ctx.bumps.allowed_token;
        Ok(())
    }

    pub fn set_token_allowed(ctx: Context<SetTokenAllowed>, allowed: bool) -> Result<()> {
        ctx.accounts.allowed_token.allowed = allowed;
        Ok(())
    }

    pub fn register_caller(ctx: Context<RegisterCaller>) -> Result<()> {
        let rent_floor = Rent::get()?.minimum_balance(0);
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: ctx.accounts.bond_vault.to_account_info(),
                },
            ),
            rent_floor,
        )?;

        let rec = &mut ctx.accounts.caller_record;
        rec.caller = ctx.accounts.caller.key();
        rec.genesis_mint = Pubkey::default();
        rec.is_seeker_verified = false;
        rec.bond_lamports = 0;
        rec.withdraw_ready_at = 0;
        rec.settled = 0;
        rec.losses = 0;
        rec.negligent = 0;
        rec.refunded = 0;
        rec.split = 0;
        rec.slashes = 0;
        rec.active = 0;
        rec.last_active = Clock::get()?.unix_timestamp;
        rec.sum_net_bps = 0;
        rec.bump = ctx.bumps.caller_record;
        rec.bond_vault_bump = ctx.bumps.bond_vault;
        Ok(())
    }

    pub fn post_bond(ctx: Context<PostBond>, amount: u64) -> Result<()> {
        require!(amount > 0, PercayaError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: ctx.accounts.bond_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let rec = &mut ctx.accounts.caller_record;
        rec.bond_lamports = rec
            .bond_lamports
            .checked_add(amount)
            .ok_or(PercayaError::MathOverflow)?;
        rec.withdraw_ready_at = 0;
        require!(
            rec.bond_lamports >= ctx.accounts.config.params.min_bond,
            PercayaError::InsufficientBond
        );

        emit!(BondPosted {
            caller: rec.caller,
            added_lamports: amount,
            total_bond_lamports: rec.bond_lamports,
        });
        Ok(())
    }

    /// Binds a 1-per-device Token-2022 NonTransferable Seeker Genesis NFT to this caller.
    /// `GenesisRegistry` is initialized with `init` so the same hardware token can never
    /// initialize a second fresh caller record to reset negative returns or slashes.
    pub fn verify_seeker_genesis(ctx: Context<VerifySeekerGenesis>) -> Result<()> {
        let rec = &mut ctx.accounts.caller_record;
        require!(!rec.is_seeker_verified, PercayaError::AlreadySeekerVerified);

        let mint_parsed = parse_mint(&ctx.accounts.genesis_mint)?;
        let tok_parsed = parse_token_account(&ctx.accounts.genesis_token_account)?;

        require!(
            mint_parsed.is_token_2022
                && mint_parsed.is_non_transferable
                && mint_parsed.decimals == 0
                && mint_parsed.mint_authority == Some(ctx.accounts.config.genesis_authority)
                && tok_parsed.mint == ctx.accounts.genesis_mint.key()
                && tok_parsed.owner == ctx.accounts.caller.key()
                && tok_parsed.amount == 1,
            PercayaError::InvalidSeekerGenesis
        );

        let reg = &mut ctx.accounts.genesis_registry;
        reg.genesis_mint = ctx.accounts.genesis_mint.key();
        reg.bound_caller = ctx.accounts.caller.key();
        reg.slashed = rec.slashes > 0;
        reg.bump = ctx.bumps.genesis_registry;

        rec.genesis_mint = reg.genesis_mint;
        rec.is_seeker_verified = true;

        emit!(SeekerGenesisVerified {
            caller: rec.caller,
            genesis_mint: rec.genesis_mint,
        });
        Ok(())
    }

    pub fn request_bond_withdraw(ctx: Context<ManageBond>) -> Result<()> {
        let rec = &mut ctx.accounts.caller_record;
        require!(rec.active == 0, PercayaError::ActiveCallsExist);
        require!(rec.bond_lamports > 0, PercayaError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        rec.withdraw_ready_at = now
            .checked_add(i64::from(ctx.accounts.config.params.bond_cooldown))
            .ok_or(PercayaError::MathOverflow)?;
        Ok(())
    }

    pub fn withdraw_bond(ctx: Context<ManageBond>, amount: u64) -> Result<()> {
        let rec = &mut ctx.accounts.caller_record;
        require!(rec.active == 0, PercayaError::ActiveCallsExist);
        require!(amount > 0 && amount <= rec.bond_lamports, PercayaError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(
            rec.withdraw_ready_at != 0 && now >= rec.withdraw_ready_at,
            PercayaError::BondCooldownNotReady
        );

        let caller_key = rec.caller;
        let vault_bump = rec.bond_vault_bump;
        let seeds: &[&[u8]] = &[BOND_VAULT_SEED, caller_key.as_ref(), &[vault_bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.bond_vault.to_account_info(),
                    to: ctx.accounts.caller.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        rec.bond_lamports = rec
            .bond_lamports
            .checked_sub(amount)
            .ok_or(PercayaError::MathOverflow)?;
        if rec.bond_lamports == 0 {
            rec.withdraw_ready_at = 0;
        }
        Ok(())
    }

    pub fn slash(ctx: Context<SlashCaller>, amount: u64, reason: String) -> Result<()> {
        require!(
            !reason.is_empty() && reason.len() <= 200,
            PercayaError::InvalidSlashReason
        );
        require!(amount > 0, PercayaError::ZeroAmount);

        let rec = &mut ctx.accounts.caller_record;
        let slashed_amt = amount.min(rec.bond_lamports);

        if rec.is_seeker_verified {
            let (expected_reg, _) =
                Pubkey::find_program_address(&[GENESIS_SEED, rec.genesis_mint.as_ref()], &crate::ID);
            require!(
                ctx.accounts.genesis_registry.key() == expected_reg
                    && ctx.accounts.genesis_registry.owner == &crate::ID,
                PercayaError::InvalidGenesisRegistry
            );
            let mut reg_data = ctx.accounts.genesis_registry.try_borrow_mut_data()?;
            // Layout: 8 discriminator + 32 genesis_mint + 32 bound_caller + 1 slashed (offset 72)
            require!(reg_data.len() >= 73, PercayaError::InvalidGenesisRegistry);
            reg_data[72] = 1;
        }

        if slashed_amt > 0 {
            let caller_key = rec.caller;
            let vault_bump = rec.bond_vault_bump;
            let seeds: &[&[u8]] = &[BOND_VAULT_SEED, caller_key.as_ref(), &[vault_bump]];
            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program::ID,
                    system_program::Transfer {
                        from: ctx.accounts.bond_vault.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                    &[seeds],
                ),
                slashed_amt,
            )?;
            rec.bond_lamports = rec
                .bond_lamports
                .checked_sub(slashed_amt)
                .ok_or(PercayaError::MathOverflow)?;
        }

        rec.slashes = rec.slashes.checked_add(1).ok_or(PercayaError::MathOverflow)?;

        emit!(BondSlashed {
            caller: rec.caller,
            slashed_lamports: slashed_amt,
            remaining_bond_lamports: rec.bond_lamports,
            slashes_count: rec.slashes,
            reason,
        });
        Ok(())
    }

    pub fn open_call(ctx: Context<OpenCall>, args: OpenCallArgs) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.open_paused, PercayaError::OpenPaused);
        require!(
            ctx.accounts.allowed_token.allowed,
            PercayaError::TokenNotAllowed
        );
        require!(args.stake_lamports > 0, PercayaError::ZeroAmount);
        require!(
            args.thesis.len() <= MAX_THESIS_BYTES,
            PercayaError::ThesisTooLong
        );

        let p = cfg.params;
        require!(
            args.window_duration >= p.min_window
                && args.window_duration <= p.max_window
                && args.max_hold_duration >= p.min_hold
                && args.max_hold_duration <= p.max_hold
                && args.stop_loss_bps >= p.min_stop_loss_bps
                && args.stop_loss_bps <= p.max_stop_loss_bps
                && (args.take_profit_bps == 0
                    || (args.take_profit_bps >= 100 && args.take_profit_bps <= MAX_TAKE_PROFIT_BPS)),
            PercayaError::InvalidCallRules
        );

        let rec = &mut ctx.accounts.caller_record;
        require!(rec.bond_lamports >= p.min_bond, PercayaError::InsufficientBond);

        let (tier, multiple, max_share_bps) = rec.tier_limits();
        require!(
            args.share_bps <= max_share_bps,
            PercayaError::ProfitShareExceedsTier
        );

        let cap = rec
            .bond_lamports
            .checked_mul(multiple)
            .ok_or(PercayaError::MathOverflow)?;
        require!(args.stake_lamports <= cap, PercayaError::CapExceeded);

        let pool = &ctx.accounts.amm_pool;
        let impact = amm_math::impact_bps(pool.sol_reserve, args.stake_lamports, pool.fee_bps)?;
        require!(impact <= p.max_impact_bps, PercayaError::PriceImpactTooHigh);

        let now = Clock::get()?.unix_timestamp;
        let window_end = now
            .checked_add(i64::from(args.window_duration))
            .ok_or(PercayaError::MathOverflow)?;
        let buy_deadline = window_end
            .checked_add(i64::from(p.buy_grace))
            .ok_or(PercayaError::MathOverflow)?;

        let rent_floor = Rent::get()?.minimum_balance(0);
        let to_fund = rent_floor
            .checked_add(args.stake_lamports)
            .ok_or(PercayaError::MathOverflow)?;

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            to_fund,
        )?;

        let call_id = cfg.next_call_id;
        cfg.next_call_id = cfg
            .next_call_id
            .checked_add(1)
            .ok_or(PercayaError::MathOverflow)?;

        let call = &mut ctx.accounts.call_pool;
        call.call_id = call_id;
        call.caller = ctx.accounts.caller.key();
        call.token_mint = ctx.accounts.allowed_token.token_mint;
        call.opened_at = now;
        call.state = CallState::Open;
        call.settle_reason = 0;
        call.rules = CallRules {
            amm_pool: pool.key(),
            window_end,
            buy_deadline,
            max_hold: args.max_hold_duration,
            take_profit_bps: args.take_profit_bps,
            stop_loss_bps: args.stop_loss_bps,
            share_bps: args.share_bps,
            min_caller_bps: p.min_caller_bps,
            max_impact_bps: p.max_impact_bps,
            sell_tolerance_bps: p.sell_tolerance_bps,
            keeper_bps: p.keeper_bps,
            checkpoint_gap: p.checkpoint_gap,
            split_grace: p.split_grace,
            cap,
            min_pool: p.min_pool,
        };
        call.total_in = args.stake_lamports;
        call.caller_stake = args.stake_lamports;
        call.depositors_count = 1;
        call.claims_left = 1;
        call.tokens_bought = 0;
        call.bought_at = 0;
        call.hold_until = 0;
        call.prev_checkpoint = Checkpoint::default();
        call.last_checkpoint = Checkpoint::default();
        call.gross_out = 0;
        call.payout = 0;
        call.fee = 0;
        call.claimed_amount = 0;
        call.net_return_bps = 0;
        call.bump = ctx.bumps.call_pool;
        call.sol_vault_bump = ctx.bumps.sol_vault;
        call.thesis = args.thesis;

        let pos = &mut ctx.accounts.caller_position;
        pos.call_id = call_id;
        pos.participant = ctx.accounts.caller.key();
        pos.deposited = args.stake_lamports;
        pos.claimed = false;
        pos.bump = ctx.bumps.caller_position;

        rec.active = rec.active.checked_add(1).ok_or(PercayaError::MathOverflow)?;
        rec.withdraw_ready_at = 0;
        rec.last_active = now;

        emit!(CallOpened {
            call_id,
            call_pda: call.key(),
            caller: call.caller,
            token_mint: call.token_mint,
            amm_pool: call.rules.amm_pool,
            stake_lamports: args.stake_lamports,
            cap_lamports: cap,
            window_end,
            buy_deadline,
            max_hold: args.max_hold_duration,
            take_profit_bps: args.take_profit_bps,
            stop_loss_bps: args.stop_loss_bps,
            share_bps: args.share_bps,
            tier,
        });
        Ok(())
    }

    pub fn init_position(ctx: Context<InitPosition>) -> Result<()> {
        require!(
            ctx.accounts.call_pool.state == CallState::Open,
            PercayaError::InvalidCallState
        );
        let pos = &mut ctx.accounts.position;
        pos.call_id = ctx.accounts.call_pool.call_id;
        pos.participant = ctx.accounts.participant.key();
        pos.deposited = 0;
        pos.claimed = false;
        pos.bump = ctx.bumps.position;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, PercayaError::ZeroAmount);
        let call = &mut ctx.accounts.call_pool;
        require!(call.state == CallState::Open, PercayaError::InvalidCallState);
        let now = Clock::get()?.unix_timestamp;
        require!(now < call.rules.window_end, PercayaError::WindowClosed);

        let new_total = call
            .total_in
            .checked_add(amount)
            .ok_or(PercayaError::MathOverflow)?;
        require!(new_total <= call.rules.cap, PercayaError::CapExceeded);

        let new_caller_stake = if ctx.accounts.participant.key() == call.caller {
            call.caller_stake
                .checked_add(amount)
                .ok_or(PercayaError::MathOverflow)?
        } else {
            call.caller_stake
        };

        // Enforce caller >= min_caller_bps (5%) at every deposit so a late joiner cannot stall buy()
        require!(
            u128::from(new_caller_stake)
                .checked_mul(BPS_DENOMINATOR)
                .ok_or(PercayaError::MathOverflow)?
                >= u128::from(new_total)
                    .checked_mul(u128::from(call.rules.min_caller_bps))
                    .ok_or(PercayaError::MathOverflow)?,
            PercayaError::CallerShareTooLow
        );

        let pool = &ctx.accounts.amm_pool;
        let impact = amm_math::impact_bps(pool.sol_reserve, new_total, pool.fee_bps)?;
        require!(
            impact <= call.rules.max_impact_bps,
            PercayaError::PriceImpactTooHigh
        );

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.participant.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let pos = &mut ctx.accounts.position;
        if pos.deposited == 0 {
            call.depositors_count = call
                .depositors_count
                .checked_add(1)
                .ok_or(PercayaError::MathOverflow)?;
            call.claims_left = call
                .claims_left
                .checked_add(1)
                .ok_or(PercayaError::MathOverflow)?;
        }
        pos.deposited = pos
            .deposited
            .checked_add(amount)
            .ok_or(PercayaError::MathOverflow)?;
        call.total_in = new_total;
        call.caller_stake = new_caller_stake;

        emit!(PoolDeposited {
            call_id: call.call_id,
            participant: pos.participant,
            amount_lamports: amount,
            total_in_lamports: call.total_in,
        });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PercayaError::ZeroAmount);
        let call = &mut ctx.accounts.call_pool;
        require!(call.state == CallState::Open, PercayaError::InvalidCallState);
        require!(
            ctx.accounts.participant.key() != call.caller,
            PercayaError::CallerCannotWithdraw
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now < call.rules.window_end, PercayaError::WindowClosed);

        let pos = &mut ctx.accounts.position;
        require!(amount <= pos.deposited, PercayaError::InsufficientDeposit);

        let id_bytes = call.call_id.to_le_bytes();
        let vault_bump = call.sol_vault_bump;
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, id_bytes.as_ref(), &[vault_bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.sol_vault.to_account_info(),
                    to: ctx.accounts.participant.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        pos.deposited = pos
            .deposited
            .checked_sub(amount)
            .ok_or(PercayaError::MathOverflow)?;
        call.total_in = call
            .total_in
            .checked_sub(amount)
            .ok_or(PercayaError::MathOverflow)?;

        if pos.deposited == 0 {
            call.depositors_count = call
                .depositors_count
                .checked_sub(1)
                .ok_or(PercayaError::MathOverflow)?;
            call.claims_left = call
                .claims_left
                .checked_sub(1)
                .ok_or(PercayaError::MathOverflow)?;
        }

        emit!(PoolWithdrawn {
            call_id: call.call_id,
            participant: pos.participant,
            amount_lamports: amount,
            total_in_lamports: call.total_in,
        });
        Ok(())
    }

    pub fn buy(ctx: Context<BuyPool>, min_tokens_out: u64) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        require!(call.state == CallState::Open, PercayaError::InvalidCallState);
        require!(
            ctx.accounts.caller.key() == call.caller,
            PercayaError::OnlyCallerMayBuy
        );
        require!(
            ctx.accounts.allowed_token.allowed,
            PercayaError::TokenNotAllowed
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now >= call.rules.window_end, PercayaError::WindowStillOpen);
        require!(now <= call.rules.buy_deadline, PercayaError::BuyDeadlinePassed);
        require!(call.total_in >= call.rules.min_pool, PercayaError::BelowMinPool);
        require!(call.total_in <= call.rules.cap, PercayaError::CapExceeded);
        require!(
            u128::from(call.caller_stake)
                .checked_mul(BPS_DENOMINATOR)
                .ok_or(PercayaError::MathOverflow)?
                >= u128::from(call.total_in)
                    .checked_mul(u128::from(call.rules.min_caller_bps))
                    .ok_or(PercayaError::MathOverflow)?,
            PercayaError::CallerShareTooLow
        );

        let vault_tok = parse_token_account(&ctx.accounts.call_token_vault)?;
        require!(
            vault_tok.mint == call.token_mint && vault_tok.owner == call.key(),
            PercayaError::InvalidCallTokenVault
        );

        let pool = &ctx.accounts.amm_pool;
        let impact = amm_math::impact_bps(pool.sol_reserve, call.total_in, pool.fee_bps)?;
        require!(
            impact <= call.rules.max_impact_bps,
            PercayaError::PriceImpactTooHigh
        );

        let before_tokens = vault_tok.amount;
        let id_bytes = call.call_id.to_le_bytes();
        let sol_vault_bump = call.sol_vault_bump;
        let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, id_bytes.as_ref(), &[sol_vault_bump]];

        percaya_amm::cpi::swap_exact_sol_for_tokens(
            CpiContext::new_with_signer(
                percaya_amm::ID,
                percaya_amm::cpi::accounts::SwapExactSolForTokens {
                    payer: ctx.accounts.sol_vault.to_account_info(),
                    amm_pool: ctx.accounts.amm_pool.to_account_info(),
                    amm_sol_vault: ctx.accounts.amm_sol_vault.to_account_info(),
                    token_mint: ctx.accounts.token_mint.to_account_info(),
                    token_vault: ctx.accounts.amm_token_vault.to_account_info(),
                    user_token_out: ctx.accounts.call_token_vault.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[vault_seeds],
            ),
            call.total_in,
            min_tokens_out,
        )?;

        let after_tokens = parse_token_account(&ctx.accounts.call_token_vault)?.amount;
        let received_tokens = after_tokens
            .checked_sub(before_tokens)
            .ok_or(PercayaError::MathOverflow)?;
        require!(
            received_tokens > 0 && received_tokens >= min_tokens_out,
            PercayaError::BuySlippageExceeded
        );

        call.tokens_bought = received_tokens;
        call.bought_at = now;
        call.hold_until = now
            .checked_add(i64::from(call.rules.max_hold))
            .ok_or(PercayaError::MathOverflow)?;
        call.state = CallState::Holding;

        emit!(PoolBought {
            call_id: call.call_id,
            total_in_lamports: call.total_in,
            tokens_bought: received_tokens,
            bought_at: now,
            hold_until: call.hold_until,
        });
        Ok(())
    }

    pub fn checkpoint(ctx: Context<RecordCheckpoint>) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        require!(
            call.state == CallState::Holding,
            PercayaError::InvalidCallState
        );
        let now = Clock::get()?.unix_timestamp;
        if call.last_checkpoint.at != 0 {
            let earliest = call
                .last_checkpoint
                .at
                .checked_add(i64::from(call.rules.checkpoint_gap))
                .ok_or(PercayaError::MathOverflow)?;
            require!(now >= earliest, PercayaError::CheckpointTooSoon);
        }

        let pool = &ctx.accounts.amm_pool;
        let quote = amm_math::quote_sell(
            pool.sol_reserve,
            pool.token_reserve,
            call.tokens_bought,
            pool.fee_bps,
        )?;

        call.prev_checkpoint = call.last_checkpoint;
        call.last_checkpoint = Checkpoint {
            value: quote,
            at: now,
        };

        emit!(PriceCheckpointed {
            call_id: call.call_id,
            quote_lamports: quote,
            at: now,
        });
        Ok(())
    }

    pub fn sell(ctx: Context<SellPool>) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        require!(
            call.state == CallState::Holding,
            PercayaError::InvalidCallState
        );

        let now = Clock::get()?.unix_timestamp;
        let prev = call.prev_checkpoint;
        let last = call.last_checkpoint;
        let gap = i64::from(call.rules.checkpoint_gap);

        require!(
            prev.at != 0
                && last.at >= prev.at.checked_add(gap).ok_or(PercayaError::MathOverflow)?
                && now <= last.at.checked_add(gap).ok_or(PercayaError::MathOverflow)?,
            PercayaError::CheckpointsNotReady
        );

        let total_in_u128 = u128::from(call.total_in);
        let mut reason: u8 = 0;

        if call.rules.take_profit_bps > 0 {
            let tp_target = total_in_u128
                .checked_mul(BPS_DENOMINATOR + u128::from(call.rules.take_profit_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR;
            if u128::from(prev.value) >= tp_target && u128::from(last.value) >= tp_target {
                reason = 1;
            }
        }

        if reason == 0 {
            let sl_floor = total_in_u128
                .checked_mul(BPS_DENOMINATOR - u128::from(call.rules.stop_loss_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR;
            if u128::from(prev.value) <= sl_floor && u128::from(last.value) <= sl_floor {
                reason = 2;
            }
        }

        if reason == 0 && now >= call.hold_until {
            let higher = u128::from(prev.value.max(last.value));
            let lower = u128::from(prev.value.min(last.value));
            let diff = higher - lower;
            let max_diff = higher
                .checked_mul(u128::from(call.rules.sell_tolerance_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR;
            if diff <= max_diff {
                reason = 3;
            }
        }

        require!(reason != 0, PercayaError::NoSellConditionMet);

        let min_cp = u128::from(prev.value.min(last.value));
        let min_out = u64::try_from(
            min_cp
                .checked_mul(BPS_DENOMINATOR - u128::from(call.rules.sell_tolerance_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR,
        )
        .map_err(|_| error!(PercayaError::MathOverflow))?;

        let before_lamports = ctx.accounts.sol_vault.lamports();
        let id_bytes = call.call_id.to_le_bytes();
        let call_bump = call.bump;
        let call_seeds: &[&[u8]] = &[CALL_SEED, id_bytes.as_ref(), &[call_bump]];
        let tokens_to_sell = call.tokens_bought;

        percaya_amm::cpi::swap_exact_tokens_for_sol(
            CpiContext::new_with_signer(
                percaya_amm::ID,
                percaya_amm::cpi::accounts::SwapExactTokensForSol {
                    authority: call.to_account_info(),
                    sol_recipient: ctx.accounts.sol_vault.to_account_info(),
                    amm_pool: ctx.accounts.amm_pool.to_account_info(),
                    amm_sol_vault: ctx.accounts.amm_sol_vault.to_account_info(),
                    token_mint: ctx.accounts.token_mint.to_account_info(),
                    token_vault: ctx.accounts.amm_token_vault.to_account_info(),
                    user_token_in: ctx.accounts.call_token_vault.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[call_seeds],
            ),
            tokens_to_sell,
            min_out,
        )?;

        let after_lamports = ctx.accounts.sol_vault.lamports();
        let gross = after_lamports
            .checked_sub(before_lamports)
            .ok_or(PercayaError::MathOverflow)?;
        require!(gross >= min_out, PercayaError::SellBelowFloor);

        let keeper_reward = u64::try_from(
            u128::from(gross)
                .checked_mul(u128::from(call.rules.keeper_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR,
        )
        .map_err(|_| error!(PercayaError::MathOverflow))?;

        if keeper_reward > 0 {
            let sol_vault_bump = call.sol_vault_bump;
            let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, id_bytes.as_ref(), &[sol_vault_bump]];
            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program::ID,
                    system_program::Transfer {
                        from: ctx.accounts.sol_vault.to_account_info(),
                        to: ctx.accounts.keeper.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                keeper_reward,
            )?;
        }

        let net = gross
            .checked_sub(keeper_reward)
            .ok_or(PercayaError::MathOverflow)?;
        let profit = net.saturating_sub(call.total_in);
        let fee = u64::try_from(
            u128::from(profit)
                .checked_mul(u128::from(call.rules.share_bps))
                .ok_or(PercayaError::MathOverflow)?
                / BPS_DENOMINATOR,
        )
        .map_err(|_| error!(PercayaError::MathOverflow))?;
        let payout = net.checked_sub(fee).ok_or(PercayaError::MathOverflow)?;

        let net_diff = i128::from(payout) - i128::from(call.total_in);
        let net_return_bps = i64::try_from(
            net_diff
                .checked_mul(10_000)
                .ok_or(PercayaError::MathOverflow)?
                / i128::from(call.total_in),
        )
        .map_err(|_| error!(PercayaError::MathOverflow))?;

        call.gross_out = gross;
        call.payout = payout;
        call.fee = fee;
        call.net_return_bps = net_return_bps;
        call.settle_reason = reason;
        call.state = CallState::Settled;

        let rec = &mut ctx.accounts.caller_record;
        rec.settled = rec.settled.checked_add(1).ok_or(PercayaError::MathOverflow)?;
        if net_return_bps < 0 {
            rec.losses = rec.losses.checked_add(1).ok_or(PercayaError::MathOverflow)?;
        }
        rec.sum_net_bps = rec
            .sum_net_bps
            .checked_add(net_return_bps)
            .ok_or(PercayaError::MathOverflow)?;
        rec.active = rec.active.checked_sub(1).ok_or(PercayaError::MathOverflow)?;
        rec.last_active = now;

        emit!(PoolSold {
            call_id: call.call_id,
            keeper: ctx.accounts.keeper.key(),
            reason,
            gross_out_lamports: gross,
            keeper_reward_lamports: keeper_reward,
            fee_lamports: fee,
            payout_lamports: payout,
            net_return_bps,
        });
        Ok(())
    }

    pub fn refund(ctx: Context<RefundPool>) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        require!(call.state == CallState::Open, PercayaError::InvalidCallState);
        let now = Clock::get()?.unix_timestamp;

        let (reason, negligent) =
            if now >= call.rules.window_end && call.total_in < call.rules.min_pool {
                (4u8, false)
            } else if now > call.rules.buy_deadline {
                (5u8, ctx.accounts.allowed_token.allowed)
            } else {
                return err!(PercayaError::RefundNotEligible);
            };

        call.settle_reason = reason;
        call.state = CallState::Refunded;

        let rec = &mut ctx.accounts.caller_record;
        rec.refunded = rec
            .refunded
            .checked_add(1)
            .ok_or(PercayaError::MathOverflow)?;
        if negligent {
            rec.negligent = rec
                .negligent
                .checked_add(1)
                .ok_or(PercayaError::MathOverflow)?;
        }
        rec.active = rec.active.checked_sub(1).ok_or(PercayaError::MathOverflow)?;
        rec.last_active = now;

        emit!(PoolRefunded {
            call_id: call.call_id,
            reason,
            caller_negligent: negligent,
        });
        Ok(())
    }

    pub fn split(ctx: Context<SplitPool>) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        require!(
            call.state == CallState::Holding,
            PercayaError::InvalidCallState
        );
        let now = Clock::get()?.unix_timestamp;
        let split_ready_at = call
            .hold_until
            .checked_add(i64::from(call.rules.split_grace))
            .ok_or(PercayaError::MathOverflow)?;
        require!(now > split_ready_at, PercayaError::SplitNotEligible);

        call.settle_reason = 6;
        call.state = CallState::Split;

        let rec = &mut ctx.accounts.caller_record;
        rec.split = rec.split.checked_add(1).ok_or(PercayaError::MathOverflow)?;
        rec.active = rec.active.checked_sub(1).ok_or(PercayaError::MathOverflow)?;
        rec.last_active = now;

        emit!(PoolSplit {
            call_id: call.call_id,
            tokens_to_split: call.tokens_bought,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<ClaimPosition>) -> Result<()> {
        let call = &mut ctx.accounts.call_pool;
        let pos = &mut ctx.accounts.position;
        require!(
            !pos.claimed && pos.deposited > 0,
            PercayaError::NothingToClaim
        );

        let is_last = call.claims_left == 1;
        let id_bytes = call.call_id.to_le_bytes();

        match call.state {
            CallState::Refunded => {
                let share = pos.deposited;
                let vault_bump = call.sol_vault_bump;
                let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, id_bytes.as_ref(), &[vault_bump]];
                system_program::transfer(
                    CpiContext::new_with_signer(
                        system_program::ID,
                        system_program::Transfer {
                            from: ctx.accounts.sol_vault.to_account_info(),
                            to: ctx.accounts.participant.to_account_info(),
                        },
                        &[vault_seeds],
                    ),
                    share,
                )?;
                pos.claimed = true;
                call.claims_left = call
                    .claims_left
                    .checked_sub(1)
                    .ok_or(PercayaError::MathOverflow)?;
                call.claimed_amount = call
                    .claimed_amount
                    .checked_add(share)
                    .ok_or(PercayaError::MathOverflow)?;

                emit!(PositionClaimed {
                    call_id: call.call_id,
                    participant: pos.participant,
                    amount: share,
                    is_token_split: false,
                });
            }
            CallState::Settled => {
                let pro_rata = if is_last {
                    call.payout
                        .checked_sub(call.claimed_amount)
                        .ok_or(PercayaError::MathOverflow)?
                } else {
                    u64::try_from(
                        u128::from(call.payout)
                            .checked_mul(u128::from(pos.deposited))
                            .ok_or(PercayaError::MathOverflow)?
                            / u128::from(call.total_in),
                    )
                    .map_err(|_| error!(PercayaError::MathOverflow))?
                };

                let caller_bonus = if pos.participant == call.caller {
                    call.fee
                } else {
                    0
                };
                let total_sol_out = pro_rata
                    .checked_add(caller_bonus)
                    .ok_or(PercayaError::MathOverflow)?;

                let vault_bump = call.sol_vault_bump;
                let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, id_bytes.as_ref(), &[vault_bump]];
                system_program::transfer(
                    CpiContext::new_with_signer(
                        system_program::ID,
                        system_program::Transfer {
                            from: ctx.accounts.sol_vault.to_account_info(),
                            to: ctx.accounts.participant.to_account_info(),
                        },
                        &[vault_seeds],
                    ),
                    total_sol_out,
                )?;

                pos.claimed = true;
                call.claims_left = call
                    .claims_left
                    .checked_sub(1)
                    .ok_or(PercayaError::MathOverflow)?;
                call.claimed_amount = call
                    .claimed_amount
                    .checked_add(pro_rata)
                    .ok_or(PercayaError::MathOverflow)?;

                emit!(PositionClaimed {
                    call_id: call.call_id,
                    participant: pos.participant,
                    amount: total_sol_out,
                    is_token_split: false,
                });
            }
            CallState::Split => {
                let mint_info = parse_mint(&ctx.accounts.token_mint)?;
                let user_tok = parse_token_account(&ctx.accounts.participant_token_account)?;
                require!(
                    user_tok.mint == call.token_mint
                        && user_tok.owner == ctx.accounts.participant.key(),
                    PercayaError::InvalidCallTokenVault
                );

                let tok_share = if is_last {
                    call.tokens_bought
                        .checked_sub(call.claimed_amount)
                        .ok_or(PercayaError::MathOverflow)?
                } else {
                    u64::try_from(
                        u128::from(call.tokens_bought)
                            .checked_mul(u128::from(pos.deposited))
                            .ok_or(PercayaError::MathOverflow)?
                            / u128::from(call.total_in),
                    )
                    .map_err(|_| error!(PercayaError::MathOverflow))?
                };

                let call_bump = call.bump;
                let call_seeds: &[&[u8]] = &[CALL_SEED, id_bytes.as_ref(), &[call_bump]];
                transfer_checked(
                    &ctx.accounts.token_program,
                    &ctx.accounts.call_token_vault,
                    &ctx.accounts.token_mint,
                    &ctx.accounts.participant_token_account,
                    &call.to_account_info(),
                    tok_share,
                    mint_info.decimals,
                    &[call_seeds],
                )?;

                pos.claimed = true;
                call.claims_left = call
                    .claims_left
                    .checked_sub(1)
                    .ok_or(PercayaError::MathOverflow)?;
                call.claimed_amount = call
                    .claimed_amount
                    .checked_add(tok_share)
                    .ok_or(PercayaError::MathOverflow)?;

                emit!(PositionClaimed {
                    call_id: call.call_id,
                    participant: pos.participant,
                    amount: tok_share,
                    is_token_split: true,
                });
            }
            _ => return err!(PercayaError::InvalidCallState),
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ PercayaError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
}

#[derive(Accounts)]
pub struct RegisterToken<'info> {
    #[account(mut, address = config.admin @ PercayaError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    /// CHECK: Verified against amm_pool.token_mint
    pub token_mint: UncheckedAccount<'info>,
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        init,
        payer = admin,
        space = 8 + AllowedToken::INIT_SPACE,
        seeds = [ALLOWED_TOKEN_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTokenAllowed<'info> {
    #[account(address = config.admin @ PercayaError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [ALLOWED_TOKEN_SEED, allowed_token.token_mint.as_ref()],
        bump = allowed_token.bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
}

#[derive(Accounts)]
pub struct RegisterCaller<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        init,
        payer = caller,
        space = 8 + CallerRecord::INIT_SPACE,
        seeds = [CALLER_SEED, caller.key().as_ref()],
        bump
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, caller.key().as_ref()],
        bump
    )]
    pub bond_vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostBond<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CALLER_SEED, caller.key().as_ref()],
        bump = caller_record.bump,
        has_one = caller
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, caller.key().as_ref()],
        bump = caller_record.bond_vault_bump
    )]
    pub bond_vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifySeekerGenesis<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CALLER_SEED, caller.key().as_ref()],
        bump = caller_record.bump,
        has_one = caller
    )]
    pub caller_record: Account<'info, CallerRecord>,
    /// CHECK: Verified via spl_compat::parse_mint (Token-2022 NonTransferable + genesis_authority)
    pub genesis_mint: UncheckedAccount<'info>,
    /// CHECK: Verified via spl_compat::parse_token_account (owner == caller && amount == 1)
    pub genesis_token_account: UncheckedAccount<'info>,
    #[account(
        init,
        payer = caller,
        space = 8 + GenesisRegistry::INIT_SPACE,
        seeds = [GENESIS_SEED, genesis_mint.key().as_ref()],
        bump
    )]
    pub genesis_registry: Account<'info, GenesisRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageBond<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CALLER_SEED, caller.key().as_ref()],
        bump = caller_record.bump,
        has_one = caller
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, caller.key().as_ref()],
        bump = caller_record.bond_vault_bump
    )]
    pub bond_vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashCaller<'info> {
    #[account(address = config.admin @ PercayaError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CALLER_SEED, caller_record.caller.as_ref()],
        bump = caller_record.bump
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, caller_record.caller.as_ref()],
        bump = caller_record.bond_vault_bump
    )]
    pub bond_vault: SystemAccount<'info>,
    /// CHECK: Treasury destination verified against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: Validated in handler when caller_record.is_seeker_verified == true
    #[account(mut)]
    pub genesis_registry: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenCall<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CALLER_SEED, caller.key().as_ref()],
        bump = caller_record.bump,
        has_one = caller
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        seeds = [ALLOWED_TOKEN_SEED, allowed_token.token_mint.as_ref()],
        bump = allowed_token.bump,
        has_one = amm_pool
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        init,
        payer = caller,
        space = 8 + CallPool::INIT_SPACE,
        seeds = [CALL_SEED, config.next_call_id.to_le_bytes().as_ref()],
        bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, config.next_call_id.to_le_bytes().as_ref()],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        init,
        payer = caller,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, config.next_call_id.to_le_bytes().as_ref(), caller.key().as_ref()],
        bump
    )]
    pub caller_position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPosition<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        init,
        payer = participant,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, call_pool.call_id.to_le_bytes().as_ref(), participant.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [POSITION_SEED, call_pool.call_id.to_le_bytes().as_ref(), participant.key().as_ref()],
        bump = position.bump,
        has_one = participant
    )]
    pub position: Account<'info, Position>,
    #[account(address = call_pool.rules.amm_pool)]
    pub amm_pool: Account<'info, AmmPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [POSITION_SEED, call_pool.call_id.to_le_bytes().as_ref(), participant.key().as_ref()],
        bump = position.bump,
        has_one = participant
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyPool<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        seeds = [ALLOWED_TOKEN_SEED, call_pool.token_mint.as_ref()],
        bump = allowed_token.bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    #[account(mut, address = call_pool.rules.amm_pool)]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [percaya_amm::AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump = amm_pool.sol_vault_bump,
        seeds::program = percaya_amm::ID
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Verified against call_pool.token_mint
    #[account(address = call_pool.token_mint)]
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Verified against amm_pool.token_vault
    #[account(mut, address = amm_pool.token_vault)]
    pub amm_token_vault: UncheckedAccount<'info>,
    /// CHECK: Verified in handler (owner == call_pool && mint == token_mint)
    #[account(mut)]
    pub call_token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated in percaya_amm CPI
    pub token_program: UncheckedAccount<'info>,
    pub amm_program: Program<'info, percaya_amm::program::PercayaAmm>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordCheckpoint<'info> {
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(address = call_pool.rules.amm_pool)]
    pub amm_pool: Account<'info, AmmPool>,
}

#[derive(Accounts)]
pub struct SellPool<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [CALLER_SEED, call_pool.caller.as_ref()],
        bump = caller_record.bump
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(mut, address = call_pool.rules.amm_pool)]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [percaya_amm::AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump = amm_pool.sol_vault_bump,
        seeds::program = percaya_amm::ID
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Verified against call_pool.token_mint
    #[account(address = call_pool.token_mint)]
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Verified against amm_pool.token_vault
    #[account(mut, address = amm_pool.token_vault)]
    pub amm_token_vault: UncheckedAccount<'info>,
    /// CHECK: Token vault owned by call_pool PDA
    #[account(mut)]
    pub call_token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated in percaya_amm CPI
    pub token_program: UncheckedAccount<'info>,
    pub amm_program: Program<'info, percaya_amm::program::PercayaAmm>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundPool<'info> {
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [CALLER_SEED, call_pool.caller.as_ref()],
        bump = caller_record.bump
    )]
    pub caller_record: Account<'info, CallerRecord>,
    #[account(
        seeds = [ALLOWED_TOKEN_SEED, call_pool.token_mint.as_ref()],
        bump = allowed_token.bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
}

#[derive(Accounts)]
pub struct SplitPool<'info> {
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [CALLER_SEED, call_pool.caller.as_ref()],
        bump = caller_record.bump
    )]
    pub caller_record: Account<'info, CallerRecord>,
}

#[derive(Accounts)]
pub struct ClaimPosition<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [CALL_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.bump
    )]
    pub call_pool: Account<'info, CallPool>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, call_pool.call_id.to_le_bytes().as_ref()],
        bump = call_pool.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [POSITION_SEED, call_pool.call_id.to_le_bytes().as_ref(), participant.key().as_ref()],
        bump = position.bump,
        has_one = participant
    )]
    pub position: Account<'info, Position>,
    /// CHECK: Used and validated during Split claims
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Used and validated during Split claims
    #[account(mut)]
    pub call_token_vault: UncheckedAccount<'info>,
    /// CHECK: Used and validated during Split claims
    #[account(mut)]
    pub participant_token_account: UncheckedAccount<'info>,
    /// CHECK: Used and validated during Split claims
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
