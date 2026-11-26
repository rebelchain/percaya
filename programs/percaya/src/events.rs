use anchor_lang::prelude::*;

#[event]
pub struct BondPosted {
    pub caller: Pubkey,
    pub added_lamports: u64,
    pub total_bond_lamports: u64,
}

#[event]
pub struct SeekerGenesisVerified {
    pub caller: Pubkey,
    pub genesis_mint: Pubkey,
}

#[event]
pub struct BondSlashed {
    pub caller: Pubkey,
    pub slashed_lamports: u64,
    pub remaining_bond_lamports: u64,
    pub slashes_count: u32,
    pub reason: String,
}

#[event]
pub struct CallOpened {
    pub call_id: u64,
    pub call_pda: Pubkey,
    pub caller: Pubkey,
    pub token_mint: Pubkey,
    pub amm_pool: Pubkey,
    pub stake_lamports: u64,
    pub cap_lamports: u64,
    pub window_end: i64,
    pub buy_deadline: i64,
    pub max_hold: u32,
    pub take_profit_bps: u32,
    pub stop_loss_bps: u16,
    pub share_bps: u16,
    pub tier: u8,
}

#[event]
pub struct PoolDeposited {
    pub call_id: u64,
    pub participant: Pubkey,
    pub amount_lamports: u64,
    pub total_in_lamports: u64,
}

#[event]
pub struct PoolWithdrawn {
    pub call_id: u64,
    pub participant: Pubkey,
    pub amount_lamports: u64,
    pub total_in_lamports: u64,
}

#[event]
pub struct PoolBought {
    pub call_id: u64,
    pub total_in_lamports: u64,
    pub tokens_bought: u64,
    pub bought_at: i64,
    pub hold_until: i64,
}

#[event]
pub struct PriceCheckpointed {
    pub call_id: u64,
    pub quote_lamports: u64,
    pub at: i64,
}

#[event]
pub struct PoolSold {
    pub call_id: u64,
    pub keeper: Pubkey,
    pub reason: u8,
    pub gross_out_lamports: u64,
    pub keeper_reward_lamports: u64,
    pub fee_lamports: u64,
    pub payout_lamports: u64,
    pub net_return_bps: i64,
}

#[event]
pub struct PoolRefunded {
    pub call_id: u64,
    pub reason: u8,
    pub caller_negligent: bool,
}

#[event]
pub struct PoolSplit {
    pub call_id: u64,
    pub tokens_to_split: u64,
}

#[event]
pub struct PositionClaimed {
    pub call_id: u64,
    pub participant: Pubkey,
    pub amount: u64,
    pub is_token_split: bool,
}
