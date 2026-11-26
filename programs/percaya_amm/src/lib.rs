pub mod math;
pub mod spl_compat;

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::spl_compat::{parse_mint, parse_token_account, transfer_checked};

declare_id!("AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz");

pub const AMM_POOL_SEED: &[u8] = b"amm_pool";
pub const AMM_SOL_SEED: &[u8] = b"amm_sol";

#[account]
#[derive(InitSpace)]
pub struct AmmPool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub token_vault: Pubkey,
    pub token_decimals: u8,
    pub fee_bps: u16,
    pub sol_reserve: u64,
    pub token_reserve: u64,
    pub bump: u8,
    pub sol_vault_bump: u8,
}

#[event]
pub struct AmmPoolInitialized {
    pub pool: Pubkey,
    pub token_mint: Pubkey,
    pub sol_reserve: u64,
    pub token_reserve: u64,
    pub fee_bps: u16,
}

#[event]
pub struct AmmSwapped {
    pub pool: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub sol_reserve_after: u64,
    pub token_reserve_after: u64,
}

#[error_code]
pub enum AmmError {
    #[msg("Fee basis points must be below 1000 (10%)")]
    InvalidFeeBps,
    #[msg("Initial and swap amounts must be strictly positive")]
    ZeroAmount,
    #[msg("Token vault mint or owner does not match AMM pool PDA")]
    InvalidVaultAccount,
    #[msg("Swap output fell below minimum slippage guard")]
    SlippageExceeded,
    #[msg("Insufficient pool liquidity for requested swap")]
    InsufficientLiquidity,
    #[msg("Arithmetic overflow or division by zero in AMM math")]
    MathOverflow,
    #[msg("Pool reserves are empty")]
    EmptyReserves,
    #[msg("Unsupported SPL token program")]
    UnsupportedTokenProgram,
    #[msg("Invalid or uninitialized SPL mint account")]
    InvalidMintAccount,
    #[msg("Invalid or uninitialized SPL token account")]
    InvalidTokenAccount,
}

#[program]
pub mod percaya_amm {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        fee_bps: u16,
        initial_sol: u64,
        initial_tokens: u64,
    ) -> Result<()> {
        require!(fee_bps < 1000, AmmError::InvalidFeeBps);
        require!(initial_sol > 0 && initial_tokens > 0, AmmError::ZeroAmount);

        let mint_info = parse_mint(&ctx.accounts.token_mint)?;
        let vault_info = parse_token_account(&ctx.accounts.token_vault)?;
        require!(
            vault_info.mint == ctx.accounts.token_mint.key()
                && vault_info.owner == ctx.accounts.amm_pool.key(),
            AmmError::InvalidVaultAccount
        );

        let rent_floor = Rent::get()?.minimum_balance(0);
        let sol_to_fund = rent_floor
            .checked_add(initial_sol)
            .ok_or(AmmError::MathOverflow)?;

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.amm_sol_vault.to_account_info(),
                },
            ),
            sol_to_fund,
        )?;

        let before_tok = vault_info.amount;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.authority_token_account,
            &ctx.accounts.token_mint,
            &ctx.accounts.token_vault,
            &ctx.accounts.authority,
            initial_tokens,
            mint_info.decimals,
            &[],
        )?;
        let after_tok = parse_token_account(&ctx.accounts.token_vault)?.amount;
        let received_tokens = after_tok
            .checked_sub(before_tok)
            .ok_or(AmmError::MathOverflow)?;
        require!(received_tokens > 0, AmmError::ZeroAmount);

        let pool = &mut ctx.accounts.amm_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.token_decimals = mint_info.decimals;
        pool.fee_bps = fee_bps;
        pool.sol_reserve = initial_sol;
        pool.token_reserve = received_tokens;
        pool.bump = ctx.bumps.amm_pool;
        pool.sol_vault_bump = ctx.bumps.amm_sol_vault;

        emit!(AmmPoolInitialized {
            pool: pool.key(),
            token_mint: pool.token_mint,
            sol_reserve: pool.sol_reserve,
            token_reserve: pool.token_reserve,
            fee_bps: pool.fee_bps,
        });

        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        sol_amount: u64,
        token_amount: u64,
    ) -> Result<()> {
        require!(sol_amount > 0 && token_amount > 0, AmmError::ZeroAmount);
        let pool = &mut ctx.accounts.amm_pool;

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.amm_sol_vault.to_account_info(),
                },
            ),
            sol_amount,
        )?;

        let before_tok = parse_token_account(&ctx.accounts.token_vault)?.amount;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.payer_token_account,
            &ctx.accounts.token_mint,
            &ctx.accounts.token_vault,
            &ctx.accounts.payer,
            token_amount,
            pool.token_decimals,
            &[],
        )?;
        let after_tok = parse_token_account(&ctx.accounts.token_vault)?.amount;
        let delta_tok = after_tok
            .checked_sub(before_tok)
            .ok_or(AmmError::MathOverflow)?;

        pool.sol_reserve = pool
            .sol_reserve
            .checked_add(sol_amount)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_reserve = pool
            .token_reserve
            .checked_add(delta_tok)
            .ok_or(AmmError::MathOverflow)?;

        Ok(())
    }

    pub fn swap_exact_sol_for_tokens(
        ctx: Context<SwapExactSolForTokens>,
        sol_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        require!(sol_in > 0, AmmError::ZeroAmount);
        let pool = &mut ctx.accounts.amm_pool;

        let out_info = parse_token_account(&ctx.accounts.user_token_out)?;
        require!(out_info.mint == pool.token_mint, AmmError::InvalidVaultAccount);

        let tokens_out =
            math::quote_buy(pool.sol_reserve, pool.token_reserve, sol_in, pool.fee_bps)?;
        require!(tokens_out >= min_tokens_out, AmmError::SlippageExceeded);
        require!(
            tokens_out > 0 && tokens_out < pool.token_reserve,
            AmmError::InsufficientLiquidity
        );

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.amm_sol_vault.to_account_info(),
                },
            ),
            sol_in,
        )?;

        let mint_key = pool.token_mint;
        let pool_bump = pool.bump;
        let pool_seeds: &[&[u8]] = &[AMM_POOL_SEED, mint_key.as_ref(), &[pool_bump]];

        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.token_vault,
            &ctx.accounts.token_mint,
            &ctx.accounts.user_token_out,
            &pool.to_account_info(),
            tokens_out,
            pool.token_decimals,
            &[pool_seeds],
        )?;

        pool.sol_reserve = pool
            .sol_reserve
            .checked_add(sol_in)
            .ok_or(AmmError::MathOverflow)?;
        pool.token_reserve = pool
            .token_reserve
            .checked_sub(tokens_out)
            .ok_or(AmmError::MathOverflow)?;

        emit!(AmmSwapped {
            pool: pool.key(),
            trader: ctx.accounts.payer.key(),
            is_buy: true,
            sol_amount: sol_in,
            token_amount: tokens_out,
            sol_reserve_after: pool.sol_reserve,
            token_reserve_after: pool.token_reserve,
        });

        Ok(())
    }

    pub fn swap_exact_tokens_for_sol(
        ctx: Context<SwapExactTokensForSol>,
        token_in: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        require!(token_in > 0, AmmError::ZeroAmount);
        let pool = &mut ctx.accounts.amm_pool;

        let before_tok = parse_token_account(&ctx.accounts.token_vault)?.amount;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.user_token_in,
            &ctx.accounts.token_mint,
            &ctx.accounts.token_vault,
            &ctx.accounts.authority,
            token_in,
            pool.token_decimals,
            &[],
        )?;
        let after_tok = parse_token_account(&ctx.accounts.token_vault)?.amount;
        let actual_in = after_tok
            .checked_sub(before_tok)
            .ok_or(AmmError::MathOverflow)?;
        require!(actual_in > 0, AmmError::ZeroAmount);

        let sol_out =
            math::quote_sell(pool.sol_reserve, pool.token_reserve, actual_in, pool.fee_bps)?;
        require!(sol_out >= min_sol_out, AmmError::SlippageExceeded);
        require!(
            sol_out > 0 && sol_out < pool.sol_reserve,
            AmmError::InsufficientLiquidity
        );

        let pool_key = pool.key();
        let sol_vault_bump = pool.sol_vault_bump;
        let vault_seeds: &[&[u8]] = &[AMM_SOL_SEED, pool_key.as_ref(), &[sol_vault_bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer {
                    from: ctx.accounts.amm_sol_vault.to_account_info(),
                    to: ctx.accounts.sol_recipient.to_account_info(),
                },
                &[vault_seeds],
            ),
            sol_out,
        )?;

        pool.token_reserve = pool
            .token_reserve
            .checked_add(actual_in)
            .ok_or(AmmError::MathOverflow)?;
        pool.sol_reserve = pool
            .sol_reserve
            .checked_sub(sol_out)
            .ok_or(AmmError::MathOverflow)?;

        emit!(AmmSwapped {
            pool: pool.key(),
            trader: ctx.accounts.authority.key(),
            is_buy: false,
            sol_amount: sol_out,
            token_amount: actual_in,
            sol_reserve_after: pool.sol_reserve,
            token_reserve_after: pool.token_reserve,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + AmmPool::INIT_SPACE,
        seeds = [AMM_POOL_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Validated via spl_compat::parse_mint
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Validated via spl_compat::parse_token_account (mint == token_mint && owner == amm_pool)
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated by SPL transfer_checked CPI
    #[account(mut)]
    pub authority_token_account: UncheckedAccount<'info>,
    /// CHECK: Validated against SPL_TOKEN_ID / TOKEN_2022_ID
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [AMM_POOL_SEED, amm_pool.token_mint.as_ref()],
        bump = amm_pool.bump,
        has_one = token_mint,
        has_one = token_vault
    )]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump = amm_pool.sol_vault_bump
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Validated by has_one = token_mint
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by has_one = token_vault
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated by SPL transfer_checked CPI
    #[account(mut)]
    pub payer_token_account: UncheckedAccount<'info>,
    /// CHECK: Validated against SPL_TOKEN_ID / TOKEN_2022_ID
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapExactSolForTokens<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [AMM_POOL_SEED, amm_pool.token_mint.as_ref()],
        bump = amm_pool.bump,
        has_one = token_mint,
        has_one = token_vault
    )]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump = amm_pool.sol_vault_bump
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Validated by has_one
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by has_one
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated via spl_compat::parse_token_account
    #[account(mut)]
    pub user_token_out: UncheckedAccount<'info>,
    /// CHECK: Validated against SPL_TOKEN_ID / TOKEN_2022_ID
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapExactTokensForSol<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub sol_recipient: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [AMM_POOL_SEED, amm_pool.token_mint.as_ref()],
        bump = amm_pool.bump,
        has_one = token_mint,
        has_one = token_vault
    )]
    pub amm_pool: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [AMM_SOL_SEED, amm_pool.key().as_ref()],
        bump = amm_pool.sol_vault_bump
    )]
    pub amm_sol_vault: SystemAccount<'info>,
    /// CHECK: Validated by has_one
    pub token_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by has_one
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: Validated by SPL transfer_checked CPI
    #[account(mut)]
    pub user_token_in: UncheckedAccount<'info>,
    /// CHECK: Validated against SPL_TOKEN_ID / TOKEN_2022_ID
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
