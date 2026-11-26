use anchor_lang::prelude::*;
use crate::AmmError;

pub const BPS_DENOMINATOR: u128 = 10_000;

/// Exact constant-product buy quote:
/// floor((R_tok * sol_in * (10000 - fee)) / (R_sol * 10000 + sol_in * (10000 - fee)))
pub fn quote_buy(
    sol_reserve: u64,
    token_reserve: u64,
    sol_in: u64,
    fee_bps: u16,
) -> Result<u64> {
    if sol_in == 0 {
        return Ok(0);
    }
    require!(sol_reserve > 0 && token_reserve > 0, AmmError::EmptyReserves);
    let fee = u128::from(fee_bps);
    require!(fee < BPS_DENOMINATOR, AmmError::MathOverflow);

    let net_in = u128::from(sol_in)
        .checked_mul(BPS_DENOMINATOR - fee)
        .ok_or(AmmError::MathOverflow)?;
    let num = u128::from(token_reserve)
        .checked_mul(net_in)
        .ok_or(AmmError::MathOverflow)?;
    let den = u128::from(sol_reserve)
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(AmmError::MathOverflow)?
        .checked_add(net_in)
        .ok_or(AmmError::MathOverflow)?;

    u64::try_from(num / den).map_err(|_| error!(AmmError::MathOverflow))
}

/// Exact constant-product sell quote:
/// floor((R_sol * tok_in * (10000 - fee)) / (R_tok * 10000 + tok_in * (10000 - fee)))
pub fn quote_sell(
    sol_reserve: u64,
    token_reserve: u64,
    token_in: u64,
    fee_bps: u16,
) -> Result<u64> {
    if token_in == 0 {
        return Ok(0);
    }
    require!(sol_reserve > 0 && token_reserve > 0, AmmError::EmptyReserves);
    let fee = u128::from(fee_bps);
    require!(fee < BPS_DENOMINATOR, AmmError::MathOverflow);

    let net_in = u128::from(token_in)
        .checked_mul(BPS_DENOMINATOR - fee)
        .ok_or(AmmError::MathOverflow)?;
    let num = u128::from(sol_reserve)
        .checked_mul(net_in)
        .ok_or(AmmError::MathOverflow)?;
    let den = u128::from(token_reserve)
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(AmmError::MathOverflow)?
        .checked_add(net_in)
        .ok_or(AmmError::MathOverflow)?;

    u64::try_from(num / den).map_err(|_| error!(AmmError::MathOverflow))
}

/// Closed-form execution price impact in basis points (ceiling):
/// ceil((net_in * 10000) / (R_sol * 10000 + net_in))
pub fn impact_bps(sol_reserve: u64, sol_in: u64, fee_bps: u16) -> Result<u16> {
    if sol_in == 0 {
        return Ok(0);
    }
    if sol_reserve == 0 {
        return Ok(10_000);
    }
    let fee = u128::from(fee_bps);
    require!(fee < BPS_DENOMINATOR, AmmError::MathOverflow);

    let net_in = u128::from(sol_in)
        .checked_mul(BPS_DENOMINATOR - fee)
        .ok_or(AmmError::MathOverflow)?;
    let num = net_in
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(AmmError::MathOverflow)?;
    let den = u128::from(sol_reserve)
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(AmmError::MathOverflow)?
        .checked_add(net_in)
        .ok_or(AmmError::MathOverflow)?;

    let ceil_bps = num
        .checked_add(den - 1)
        .ok_or(AmmError::MathOverflow)?
        / den;
    u16::try_from(ceil_bps).map_err(|_| error!(AmmError::MathOverflow))
}

/// Closed-form O(1) max SOL input whose buy impact stays <= max_impact_bps:
/// floor((R_sol * max_impact_bps * 10000) / ((10000 - max_impact_bps) * (10000 - fee_bps)))
pub fn max_impact_sol(sol_reserve: u64, max_impact_bps: u16, fee_bps: u16) -> Result<u64> {
    if sol_reserve == 0 || max_impact_bps == 0 {
        return Ok(0);
    }
    let max_imp = u128::from(max_impact_bps);
    let fee = u128::from(fee_bps);
    require!(
        max_imp < BPS_DENOMINATOR && fee < BPS_DENOMINATOR,
        AmmError::MathOverflow
    );

    let num = u128::from(sol_reserve)
        .checked_mul(max_imp)
        .ok_or(AmmError::MathOverflow)?
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(AmmError::MathOverflow)?;
    let den = (BPS_DENOMINATOR - max_imp)
        .checked_mul(BPS_DENOMINATOR - fee)
        .ok_or(AmmError::MathOverflow)?;

    u64::try_from(num / den).map_err(|_| error!(AmmError::MathOverflow))
}
