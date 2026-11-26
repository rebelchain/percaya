use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const ALLOWED_TOKEN_SEED: &[u8] = b"allowed_token";
pub const CALLER_SEED: &[u8] = b"caller";
pub const BOND_VAULT_SEED: &[u8] = b"bond_vault";
pub const GENESIS_SEED: &[u8] = b"genesis";
pub const CALL_SEED: &[u8] = b"call";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const POSITION_SEED: &[u8] = b"position";

pub const BPS_DENOMINATOR: u128 = 10_000;
pub const MAX_KEEPER_BPS: u16 = 100; // 1.00% hard ceiling
pub const MAX_TAKE_PROFIT_BPS: u32 = 1_000_000; // 100x
pub const MAX_THESIS_BYTES: usize = 280;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ProtocolParams {
    pub min_bond: u64,
    pub min_pool: u64,
    pub min_window: u32,
    pub max_window: u32,
    pub buy_grace: u32,
    pub min_hold: u32,
    pub max_hold: u32,
    pub checkpoint_gap: u32,
    pub split_grace: u32,
    pub bond_cooldown: u32,
    pub min_stop_loss_bps: u16,
    pub max_stop_loss_bps: u16,
    pub min_caller_bps: u16,
    pub max_impact_bps: u16,
    pub sell_tolerance_bps: u16,
    pub keeper_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub treasury: Pubkey,
    pub genesis_authority: Pubkey,
    pub next_call_id: u64,
    pub open_paused: bool,
    pub bump: u8,
    pub params: ProtocolParams,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedToken {
    pub token_mint: Pubkey,
    pub amm_pool: Pubkey,
    pub allowed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CallerRecord {
    pub caller: Pubkey,
    pub genesis_mint: Pubkey,
    pub is_seeker_verified: bool,
    pub bond_lamports: u64,
    pub withdraw_ready_at: i64,
    pub settled: u32,
    pub losses: u32,
    pub negligent: u32,
    pub refunded: u32,
    pub split: u32,
    pub slashes: u32,
    pub active: u32,
    pub last_active: i64,
    pub sum_net_bps: i64,
    pub bump: u8,
    pub bond_vault_bump: u8,
}

impl CallerRecord {
    /// Computes caller's live tier (0..=3), bond cap multiplier, and max profit share bps.
    /// Tiers 1-3 strictly require Seeker Genesis hardware verification and zero slashes.
    pub fn tier_limits(&self) -> (u8, u64, u16) {
        if self.slashes > 0 || !self.is_seeker_verified || self.settled < 3 || self.sum_net_bps <= 0
        {
            return (0, 2, 500);
        }
        if self.settled >= 25 {
            (3, 20, 2000)
        } else if self.settled >= 10 {
            (2, 10, 1500)
        } else {
            (1, 5, 1000)
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct GenesisRegistry {
    pub genesis_mint: Pubkey,
    pub bound_caller: Pubkey,
    pub slashed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CallState {
    Open,
    Holding,
    Settled,
    Refunded,
    Split,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct Checkpoint {
    pub value: u64,
    pub at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct CallRules {
    pub amm_pool: Pubkey,
    pub window_end: i64,
    pub buy_deadline: i64,
    pub max_hold: u32,
    pub take_profit_bps: u32,
    pub stop_loss_bps: u16,
    pub share_bps: u16,
    pub min_caller_bps: u16,
    pub max_impact_bps: u16,
    pub sell_tolerance_bps: u16,
    pub keeper_bps: u16,
    pub checkpoint_gap: u32,
    pub split_grace: u32,
    pub cap: u64,
    pub min_pool: u64,
}

#[account]
#[derive(InitSpace)]
pub struct CallPool {
    pub call_id: u64,
    pub caller: Pubkey,
    pub token_mint: Pubkey,
    pub opened_at: i64,
    pub state: CallState,
    pub settle_reason: u8,
    pub rules: CallRules,
    pub total_in: u64,
    pub caller_stake: u64,
    pub depositors_count: u32,
    pub claims_left: u32,
    pub tokens_bought: u64,
    pub bought_at: i64,
    pub hold_until: i64,
    pub prev_checkpoint: Checkpoint,
    pub last_checkpoint: Checkpoint,
    pub gross_out: u64,
    pub payout: u64,
    pub fee: u64,
    pub claimed_amount: u64,
    pub net_return_bps: i64,
    pub bump: u8,
    pub sol_vault_bump: u8,
    #[max_len(280)]
    pub thesis: String,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub call_id: u64,
    pub participant: Pubkey,
    pub deposited: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OpenCallArgs {
    pub window_duration: u32,
    pub take_profit_bps: u32,
    pub stop_loss_bps: u16,
    pub max_hold_duration: u32,
    pub share_bps: u16,
    pub stake_lamports: u64,
    pub thesis: String,
}
