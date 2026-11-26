use anchor_lang::prelude::*;

#[error_code]
pub enum PercayaError {
    #[msg("Caller does not have admin authority")]
    UnauthorizedAdmin,
    #[msg("Caller is not the pending admin")]
    UnauthorizedPendingAdmin,
    #[msg("Invalid protocol parameter bounds")]
    InvalidParams,
    #[msg("Opening new calls is currently paused")]
    OpenPaused,
    #[msg("Token is not on the allow list")]
    TokenNotAllowed,
    #[msg("AMM pool mint does not match allowed token mint")]
    PoolMintMismatch,
    #[msg("Amount must be strictly greater than zero")]
    ZeroAmount,
    #[msg("Caller bond is below protocol minimum")]
    InsufficientBond,
    #[msg("Caller still has active open or holding calls")]
    ActiveCallsExist,
    #[msg("Bond withdrawal has not been requested or cooldown not elapsed")]
    BondCooldownNotReady,
    #[msg("Caller is already verified with a Seeker Genesis Token")]
    AlreadySeekerVerified,
    #[msg("Invalid Seeker Genesis Token-2022 non-transferable NFT or authority")]
    InvalidSeekerGenesis,
    #[msg("Invalid GenesisRegistry account for verified caller")]
    InvalidGenesisRegistry,
    #[msg("Slash reason must be non-empty and at most 200 bytes")]
    InvalidSlashReason,
    #[msg("Thesis exceeds 280 UTF-8 bytes")]
    ThesisTooLong,
    #[msg("Call rule parameter is outside protocol bounds")]
    InvalidCallRules,
    #[msg("Profit share exceeds caller tier maximum")]
    ProfitShareExceedsTier,
    #[msg("Deposit or pool size exceeds bond tier cap")]
    CapExceeded,
    #[msg("Buy price impact exceeds maximum allowed basis points")]
    PriceImpactTooHigh,
    #[msg("Caller stake would fall below minimum required pool share")]
    CallerShareTooLow,
    #[msg("Invalid call state for this instruction")]
    InvalidCallState,
    #[msg("Join window has already closed")]
    WindowClosed,
    #[msg("Join window is still open")]
    WindowStillOpen,
    #[msg("Buy deadline has passed")]
    BuyDeadlinePassed,
    #[msg("Caller cannot withdraw their stake during the join window")]
    CallerCannotWithdraw,
    #[msg("Withdraw amount exceeds participant deposit")]
    InsufficientDeposit,
    #[msg("Only the caller who opened the pool may execute the buy")]
    OnlyCallerMayBuy,
    #[msg("Pool total is below minimum required size")]
    BelowMinPool,
    #[msg("Invalid call token vault owner or mint")]
    InvalidCallTokenVault,
    #[msg("Received tokens fell below caller min_tokens_out guard")]
    BuySlippageExceeded,
    #[msg("Minimum gap between checkpoints has not elapsed yet")]
    CheckpointTooSoon,
    #[msg("Sale requires two spaced checkpoints with the latest still fresh")]
    CheckpointsNotReady,
    #[msg("Neither take-profit, stop-loss, nor max-hold agreement is met")]
    NoSellConditionMet,
    #[msg("Sale output fell below checkpoint-derived floor")]
    SellBelowFloor,
    #[msg("Refund conditions have not been met yet")]
    RefundNotEligible,
    #[msg("Split grace period after max hold has not elapsed yet")]
    SplitNotEligible,
    #[msg("Position has already been claimed or has zero deposit")]
    NothingToClaim,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
