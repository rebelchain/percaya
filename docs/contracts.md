# Smart Contract Design Specification (`Anchor / Rust`)

`percaya` consists of two Anchor programs deployed on Solana Devnet:
1. **`percaya`** — Core pooled-call state machine, immutable rule enforcement, caller bonding, hardware-bound Seeker Genesis reputation registry, and pro-rata settlement.
2. **`percaya_amm`** — Deterministic constant-product (`x * y = k`) `SOL <-> SPL` liquidity pool program implementing the swap and reserve-quote interface required by `percaya` on Devnet (and defining the adapter boundary for Raydium CPMM on Mainnet).

---

## 1. Solana design principles & EVM migration decisions

Porting `TrustPool.sol` from EVM to Solana's account model requires four structural adaptations:

1. **Bounded fixed-size PDAs instead of unbounded mappings/arrays.**  
   `TrustPool.sol` stored dynamic `depositors[]` arrays and nested `depositOf[id][user]` mappings. On Solana, dynamic `realloc` on a shared pool account creates write-lock contention and account-size ceilings. `percaya` isolates per-user state into a fixed-size **`Position` PDA** (`[b"position", call_id, user]`) and keeps `CallPool` strictly `O(1)` in space and compute regardless of participant count.
2. **Isolated `SolVault` PDA to neutralize direct lamport transfers & rent hazards.**  
   On EVM, stray native transfers revert in `receive()`. On Solana, any account can credit lamports to any address via `system_program` without invoking the recipient program. `percaya` never uses raw `vault.lamports()` as `total_in` or `pot`:
   - `SolVault` (`[b"sol_vault", call_id]`, 8-byte program-owned PDA) is initialized with its exact `rent_exempt_minimum` paid by the caller at `open_call`.
   - Accounting relies strictly on state-tracked `total_in`, `payout`, `fee`, and `claimed`, while `sell` measures the exact `after_lamports - before_lamports` delta across the CPI swap. Stray lamports donated externally cannot break `claim` invariants or cause `InsufficientFundsForRent`.
3. **On-chain reserve math (`u128`) without view-call spoofing.**  
   Solana CPI return data from arbitrary programs should not be trusted blindly for value accounting. `percaya` reads the deserialized `AmmPool` vault balances (`sol_reserve`, `token_reserve`) directly to compute `impact_bps` and `checkpoint` quotes in `u128`, and reloads `call_token_vault` / `SolVault` balances before and after swaps to measure real deltas.
4. **Hardware-bound Sybil resistance (`GenesisRegistry` PDA).**  
   By keying `GenesisRegistry` to `[b"genesis", genesis_mint]`, one Token-2022 Seeker Genesis NFT can initialize at most one reputation lineage on chain.

---

## 2. Program 1: `percaya` — Account layouts & PDA seeds

All multi-byte integers are little-endian. `BPS_DENOMINATOR = 10_000`.

### 2.1 `GlobalConfig`
- **Seeds:** `[b"config"]`
- **Space:** `8 + 196 = 204` bytes

```rust
#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,              // 32 - current admin authority
    pub pending_admin: Pubkey,      // 32 - two-step admin transfer target (Pubkey::default() if none)
    pub treasury: Pubkey,           // 32 - destination for slashed bond lamports
    pub genesis_authority: Pubkey,  // 32 - expected mint authority / collection key for Seeker Genesis NFTs
    pub next_call_id: u64,          // 8  - monotonic counter starting at 1
    pub open_paused: bool,          // 1  - pauses open_call only; active pools always settle/claim
    pub bump: u8,                   // 1
    pub params: ProtocolParams,     // 58 - defaults copied into future calls only
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct ProtocolParams {
    pub min_bond: u64,              // 8  - lamports (prod: 2 SOL, demo: 0.2 SOL)
    pub min_pool: u64,              // 8  - lamports (prod: 4 SOL, demo: 0.05 SOL)
    pub min_window: u32,            // 4  - seconds
    pub max_window: u32,            // 4  - seconds
    pub buy_grace: u32,             // 4  - seconds after window_end
    pub min_hold: u32,              // 4  - seconds
    pub max_hold: u32,              // 4  - seconds
    pub checkpoint_gap: u32,        // 4  - seconds between price checkpoints
    pub split_grace: u32,           // 4  - seconds after hold_until before token split
    pub bond_cooldown: u32,         // 4  - seconds before unbonded SOL can withdraw
    pub min_stop_loss_bps: u16,     // 2  - default 100 (1%)
    pub max_stop_loss_bps: u16,     // 2  - default 9000 (90%)
    pub min_caller_bps: u16,        // 2  - default 500 (5%)
    pub max_impact_bps: u16,        // 2  - default 200 (2%)
    pub sell_tolerance_bps: u16,    // 2  - default 200 (2%)
    pub keeper_bps: u16,            // 2  - default 10 (0.1%, hard cap MAX_KEEPER_BPS = 100)
}
```

### 2.2 `AllowedToken`
- **Seeds:** `[b"allowed_token", token_mint.key().as_ref()]`
- **Space:** `8 + 66 = 74` bytes

```rust
#[account]
pub struct AllowedToken {
    pub token_mint: Pubkey,         // 32 - SPL Token or Token-2022 mint
    pub amm_pool: Pubkey,           // 32 - bound Constant-Product / Raydium pool for quotes & swaps
    pub allowed: bool,              // 1  - false if delisted (allows no-fault refund if unbought)
    pub bump: u8,                   // 1
}
```

### 2.3 `CallerRecord` & `BondVault`
- **`CallerRecord` Seeds:** `[b"caller", caller.key().as_ref()]` (`Space: 8 + 123 = 131` bytes)
- **`BondVault` Seeds:** `[b"bond_vault", caller.key().as_ref()]` (`Space: 8` bytes — program-owned lamport vault)

```rust
#[account]
pub struct CallerRecord {
    pub caller: Pubkey,             // 32
    pub genesis_mint: Pubkey,       // 32 - Pubkey::default() if unverified; Token-2022 Genesis mint if verified
    pub is_seeker_verified: bool,   // 1  - true once verified via verify_seeker_genesis
    pub bond_lamports: u64,         // 8  - active slashable bond balance inside BondVault
    pub withdraw_ready_at: i64,     // 8  - 0 if no pending withdrawal; unix timestamp otherwise
    pub settled: u32,               // 4  - total settled pools
    pub losses: u32,                // 4  - settled pools with net_return_bps < 0
    pub negligent: u32,             // 4  - pools refunded past buy_deadline while token remained allowed
    pub refunded: u32,              // 4  - total refunded pools
    pub split: u32,                 // 4  - total split pools
    pub slashes: u32,               // 4  - > 0 permanently locks caller at Tier 0
    pub active: u32,                // 4  - currently Open or Holding calls (blocks bond withdrawal)
    pub last_active: i64,           // 8  - timestamp of latest open or terminal transition
    pub sum_net_bps: i64,           // 8  - cumulative signed participant net return in bps
    pub bump: u8,                   // 1
    pub bond_vault_bump: u8,        // 1
}
```

### 2.4 `GenesisRegistry` (Seeker Hardware Anti-Burner Gate)
- **Seeds:** `[b"genesis", genesis_mint.key().as_ref()]`
- **Space:** `8 + 66 = 74` bytes

```rust
#[account]
pub struct GenesisRegistry {
    pub genesis_mint: Pubkey,       // 32 - Token-2022 Seeker Genesis NFT mint
    pub bound_caller: Pubkey,       // 32 - original CallerRecord owner bound to this device token
    pub slashed: bool,              // 1  - permanently true if bound_caller is ever slashed
    pub bump: u8,                   // 1
}
```
*Invariant:* Because `GenesisRegistry` is initialized once per `genesis_mint` with `init` (never `close`), moving a Seeker Genesis Token between Seed Vault accounts cannot initialize a fresh `CallerRecord` at Tier 1+. One physical device gets one track record.

### 2.5 `CallPool` & `SolVault`
- **`CallPool` Seeds:** `[b"call", call_id.to_le_bytes().as_ref()]` (`Space: 8 + 542 = 550` bytes)
- **`SolVault` Seeds:** `[b"sol_vault", call_id.to_le_bytes().as_ref()]` (`Space: 8` bytes — holds pooled SOL above rent-exempt floor)
- **`call_token_vault`:** Associated Token Account owned by `CallPool` PDA for `token_mint`.

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CallState {
    Open = 0,
    Holding = 1,
    Settled = 2,
    Refunded = 3,
    Split = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Checkpoint {
    pub value: u64,                 // 8 - quoted lamport output for selling all tokens_bought
    pub at: i64,                    // 8 - unix timestamp
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct CallRules {
    pub amm_pool: Pubkey,           // 32 - locked AMM pool address
    pub window_end: i64,            // 8
    pub buy_deadline: i64,          // 8
    pub max_hold: u32,              // 4  - duration in seconds; hold_until = bought_at + max_hold
    pub take_profit_bps: u32,       // 4  - 0 (disabled) up to 1_000_000 (100x)
    pub stop_loss_bps: u16,         // 2  - 100..=9000
    pub share_bps: u16,             // 2  - caller profit share (capped by tier at open)
    pub min_caller_bps: u16,        // 2
    pub max_impact_bps: u16,        // 2
    pub sell_tolerance_bps: u16,    // 2
    pub keeper_bps: u16,            // 2
    pub checkpoint_gap: u32,        // 4
    pub split_grace: u32,           // 4
    pub cap: u64,                   // 8  - bond_lamports * tier_multiple fixed at open
    pub min_pool: u64,              // 8
}

#[account]
pub struct CallPool {
    pub call_id: u64,               // 8
    pub caller: Pubkey,             // 32
    pub token_mint: Pubkey,         // 32
    pub opened_at: i64,             // 8
    pub state: CallState,           // 1
    pub settle_reason: u8,          // 1  - 0=none, 1=TP, 2=SL, 3=MaxHold, 4=MinPoolRefund, 5=DeadlineRefund, 6=Split
    pub rules: CallRules,           // 92 - immutable after open_call
    pub total_in: u64,              // 8  - total pooled lamports
    pub caller_stake: u64,          // 8  - caller's own deposit (included in total_in)
    pub depositors_count: u32,      // 4  - active participants with deposit > 0
    pub claims_left: u32,           // 4  - decremented on each claim; 1 => sweep remainder
    pub tokens_bought: u64,         // 8  - exact SPL token delta received on buy
    pub bought_at: i64,             // 8
    pub hold_until: i64,            // 8
    pub prev_checkpoint: Checkpoint,// 16
    pub last_checkpoint: Checkpoint,// 16
    pub gross_out: u64,             // 8  - lamports received from sell swap
    pub payout: u64,                // 8  - net - fee (pro-rata pot for all depositors)
    pub fee: u64,                   // 8  - caller profit-only fee
    pub claimed_amount: u64,        // 8  - cumulative lamports (Settled/Refunded) or tokens (Split) claimed
    pub net_return_bps: i64,        // 8  - signed bps recorded to CallerRecord
    pub bump: u8,                   // 1
    pub sol_vault_bump: u8,         // 1
    pub thesis_len: u16,            // 2
    pub thesis: [u8; 280],          // 280 - fixed byte buffer (avoids String dynamic sizing issues)
}
```

### 2.6 `Position`
- **Seeds:** `[b"position", call_id.to_le_bytes().as_ref(), participant.key().as_ref()]`
- **Space:** `8 + 50 = 58` bytes

```rust
#[account]
pub struct Position {
    pub call_id: u64,               // 8
    pub participant: Pubkey,        // 32
    pub deposited: u64,             // 8  - lamports currently in pool
    pub claimed: bool,              // 1  - prevents double claim
    pub bump: u8,                   // 1
}
```

---

## 3. Program 1: `percaya` — Instructions & validation rules

| Instruction | Signer | Key checks & state transitions |
|---|---|---|
| `initialize_config(params, genesis_authority, treasury)` | `admin` | Validates `keeper_bps <= 100`, `min_window <= max_window`, `min_hold <= max_hold`, `min_stop_loss_bps >= 100 && max_stop_loss_bps <= 9000`. Initializes `GlobalConfig` with `next_call_id = 1`. |
| `update_params(params)` / `set_pause(paused)` / `transfer_admin` / `accept_admin` | `admin` / `pending_admin` | Updates defaults for future calls only. Two-step admin handover. |
| `set_allowed_token(allowed)` | `admin` | Creates or updates `AllowedToken` binding `token_mint <-> amm_pool`. Verifies `amm_pool.token_mint == token_mint`. |
| `post_bond(amount)` | `caller` | Initializes `CallerRecord` + `BondVault` if needed (`init_if_needed`), transfers `amount` lamports to `BondVault`, sets `withdraw_ready_at = 0`, requires `bond_lamports >= config.params.min_bond`. |
| `verify_seeker_genesis()` | `caller` | Verifies `genesis_token_account.owner == caller`, `amount == 1`, `genesis_mint` has `Token-2022` `MintCloseAuthority` / `NonTransferable` extension or matches `config.genesis_authority`. Initializes `GenesisRegistry` (`[b"genesis", genesis_mint]`). Sets `caller_record.is_seeker_verified = true` and `genesis_mint`. |
| `request_bond_withdraw()` | `caller` | Requires `caller_record.active == 0` and `bond_lamports > 0`. Sets `withdraw_ready_at = now + config.params.bond_cooldown`. |
| `withdraw_bond(amount)` | `caller` | Requires `active == 0`, `withdraw_ready_at != 0`, `now >= withdraw_ready_at`. Debits `BondVault` above rent floor, credits `caller`. |
| `slash(amount, reason)` | `admin` | Debits `min(amount, bond_lamports)` from `BondVault` to `treasury`. Increments `slashes += 1`. If `is_seeker_verified`, marks `GenesisRegistry.slashed = true`. Emits `BondSlashed { caller, amount, reason }`. |
| `open_call(args)` | `caller` | Requires `!open_paused`, `allowed_token.allowed`, `bond_lamports >= min_bond`, `stake >= 1`, `thesis.len() <= 280`. Computes caller's live tier (`0..=3`, requiring `is_seeker_verified && !genesis.slashed` for Tiers 1–3). Checks `share_bps <= tier_max_share`, `stake <= cap`, `impact_bps(amm_pool, stake) <= max_impact_bps`. Funds `SolVault` rent + `stake`, initializes caller `Position`, increments `caller_record.active += 1`, `withdraw_ready_at = 0`, `next_call_id += 1`. |
| `deposit(amount)` | `participant` | Requires `state == Open`, `now < window_end`, `amount > 0`. Updates `Position` (if `deposited == 0`, increments `depositors_count` and `claims_left`). Enforces `new_total <= rules.cap`, `caller_stake * 10_000 >= new_total * rules.min_caller_bps`, and `impact_bps(amm_pool, new_total) <= rules.max_impact_bps`. |
| `withdraw(amount)` | `participant` | Requires `state == Open`, `now < window_end`, `participant != call.caller` (`CallerCannotWithdraw`), `amount > 0 && amount <= pos.deposited`. If `pos.deposited` becomes `0`, decrements `depositors_count` and `claims_left`. Transfers `amount` lamports from `SolVault` to `participant`. |
| `buy(min_tokens_out)` | `caller` | Requires `state == Open`, `now >= window_end`, `now <= buy_deadline`, `allowed_token.allowed`, `total_in >= rules.min_pool`, `total_in <= rules.cap`, `caller_stake * 10_000 >= total_in * rules.min_caller_bps`, `impact_bps(amm_pool, total_in) <= rules.max_impact_bps`. CPIs `percaya_amm::swap_exact_sol_for_tokens(total_in, min_tokens_out)`. Reloads `call_token_vault`, asserts `delta >= min_tokens_out && delta > 0`. Sets `tokens_bought = delta`, `bought_at = now`, `hold_until = now + rules.max_hold`, `state = Holding`. |
| `checkpoint()` | `any` | Requires `state == Holding`. If `last_checkpoint.at != 0`, requires `now >= last_checkpoint.at + rules.checkpoint_gap`. Computes `quote = quote_sell(amm_pool, tokens_bought)`. Shifts `prev_checkpoint = last_checkpoint; last_checkpoint = Checkpoint { value: quote, at: now }`. |
| `sell()` | `keeper` (any) | Requires `state == Holding`, `prev_checkpoint.at != 0`, `last_checkpoint.at - prev_checkpoint.at >= rules.checkpoint_gap`, `now - last_checkpoint.at <= rules.checkpoint_gap`. Checks TP (`1`), SL (`2`), or MaxHold (`3`) condition. Computes `min_out = min(prev, last) * (10_000 - sell_tolerance_bps) / 10_000`. CPIs `percaya_amm::swap_exact_tokens_for_sol(tokens_bought, min_out)` into `SolVault`. Reloads `SolVault`, computes `gross_out`, transfers `keeper_reward` to `keeper`, computes `fee` & `payout`, updates `CallerRecord` (`settled += 1`, `losses` if `net_return_bps < 0`, `sum_net_bps += net_return_bps`, `active -= 1`), sets `state = Settled`. |
| `refund()` | `any` | Requires `state == Open` and either (`now >= window_end && total_in < rules.min_pool`, `reason = 4`) or (`now > buy_deadline`, `reason = 5`; increments `negligent` if `allowed_token.allowed`). Increments `refunded += 1`, decrements `active -= 1`, sets `state = Refunded`. |
| `split()` | `any` | Requires `state == Holding` and `now > hold_until + rules.split_grace`. Increments `split += 1`, decrements `active -= 1`, sets `state = Split`, `settle_reason = 6`. |
| `claim()` | `participant` | Requires `state in {Settled, Refunded, Split}`, `!pos.claimed`, `pos.deposited > 0`. Marks `pos.claimed = true`. Computes exact share (or `pot - claimed_amount` when `claims_left == 1` to sweep dust), decrements `claims_left -= 1`, increments `claimed_amount += share`, transfers SOL from `SolVault` (with caller `fee` added on `Settled` if `participant == call.caller`) or SPL tokens from `call_token_vault` (on `Split`). |

---

## 4. Program 2: `percaya_amm` & On-Chain Quote / Impact Math

### 4.1 Constant-product pool layout (`AmmPool`)
- **Seeds:** `[b"amm_pool", token_mint.key().as_ref()]`
- Holds `amm_sol_vault` (`[b"amm_sol", amm_pool]`) and `amm_token_vault` (ATA owned by `AmmPool`), with configurable `fee_bps` (default `30` = `0.30%`, matching Raydium CPMM / Uniswap standard).

### 4.2 Exact `u128` quote & price impact formulas

Given pool reserves `R_sol` (`u128`) and `R_tok` (`u128`), and swap fee `f = fee_bps` (`30` bps):

1. **Exact output quote (`quote_buy`):**
   $$\Delta_{\text{in,net}} = \Delta_{\text{sol}} \times (10000 - f)$$
   $$\text{quote\_buy}(\Delta_{\text{sol}}) = \left\lfloor \frac{R_{\text{tok}} \times \Delta_{\text{in,net}}}{R_{\text{sol}} \times 10000 + \Delta_{\text{in,net}}} \right\rfloor$$

2. **Price impact check (`impact_bps`) without floating point or probe rounding:**  
   In a constant-product pool, marginal spot output (after fee) per unit input is $\frac{R_{\text{tok}} \cdot (10000 - f)}{R_{\text{sol}} \cdot 10000}$, while effective output for size $\Delta_{\text{sol}}$ adds $\Delta_{\text{in,net}}$ to the denominator. Therefore, pure execution price impact simplifies algebraically to:
   $$\text{impact\_bps}(\Delta_{\text{sol}}) = \left\lceil \frac{\Delta_{\text{in,net}} \times 10000}{R_{\text{sol}} \times 10000 + \Delta_{\text{in,net}}} \right\rceil$$
   *Why this improves on Monad's `PROBE = 0.001 ether`:* On EVM Uniswap v4 ticks, `TrustPool.sol` had to probe with `0.001 MON` to approximate spot price. On constant-product reserves (`percaya_amm` and Raydium CPMM), the closed-form ratio above has **zero probe discretization error** and computes live `cap_of` directly in `O(1)` without a 64-step binary search:
   $$\text{max\_impact\_sol} = \left\lfloor \frac{R_{\text{sol}} \times \text{max\_impact\_bps} \times 10000}{(10000 - \text{max\_impact\_bps}) \times (10000 - f)} \right\rfloor$$

3. **Exact sell quote (`quote_sell`):**
   $$\Delta_{\text{tok,net}} = \Delta_{\text{tok}} \times (10000 - f)$$
   $$\text{quote\_sell}(\Delta_{\text{tok}}) = \left\lfloor \frac{R_{\text{sol}} \times \Delta_{\text{tok,net}}}{R_{\text{tok}} \times 10000 + \Delta_{\text{tok,net}}} \right\rfloor$$

*Mainnet Raydium CPMM Upgrade Path:* Raydium's `cp-swap` (`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`) uses the exact same two-vault constant-product formula (`vault_0`, `vault_1` minus protocol/fund fees in `PoolState`). Swapping `percaya_amm` CPI for `raydium_cp_swap::cpi::swap_base_input` requires changing only the CPI target module while keeping `CallPool` rules and impact math identical.

---

## 5. Security invariants & test suite specification

Every build runs a mandatory **LiteSVM / Anchor test suite** mirroring and extending `TrustPool.sol`'s Foundry tests:

1. **Exact Worked Examples (`unit`):**
   - `test_worked_example_profit`: `100 SOL` in, `130 SOL` gross out -> verifies exact lamport payouts (`15.6753`, `38.0649`, `50.7532`, `25.3766`, keeper `0.1300`) and `+2688 bps` record.
   - `test_worked_example_loss`: `100 SOL` in, `70 SOL` gross out -> verifies `0` fee, `-3007 bps` record, `losses == 1`.
2. **Rule Immutability (`unit`):**
   - Admin mutates every field of `GlobalConfig`, pauses new calls, delists the token after `buy`, and slashes the caller's bond mid-call -> existing `CallPool` settles and claims under its original `open_call` rules.
3. **Manipulation & Flash-Push Guards (`attack`):**
   - Single-slot whale dump + `checkpoint` + `sell` in the same slot reverts (`CheckpointTooRecent` / `InsufficientCheckpointGap`).
   - Max-hold dump where `prev` and `last` diverge by `> 2%` reverts (`CheckpointsDisagreeAtMaxHold`) so an attacker cannot dump right at `hold_until` and force a distressed floor.
4. **Seeker Genesis Sybil & Burner Resistance (`unit`):**
   - Unverified caller with 5 profitable calls stays capped at Tier 0 (`2× bond`, `5%` max fee).
   - Verified caller attempts to transfer or reuse the same `genesis_mint` on Wallet B -> `GenesisRegistry` initialization fails (`AccountAlreadyInUse`), preventing negative-record resets.
   - Slashed Genesis caller permanently drops to Tier 0.
5. **Stray Lamport & Conservation Invariants (`fuzz / stateful invariant`):**
   - Across randomized sequences of `deposit`, `withdraw`, direct `system_program::transfer` donations to `SolVault`, `buy`, `sell` / `refund` / `split`, and random-order `claim`s:
     - **Conservation Invariant 1:** `SolVault.lamports() >= rent_exempt_floor + unclaimed_sol_owed` at every slot.
     - **Conservation Invariant 2:** After all `depositors_count` participants call `claim()`, `claimed_amount == total_pot` (`payout` on `Settled`, `total_in` on `Refunded`, `tokens_bought` on `Split`) with zero stranded lamports or tokens.
     - **Symmetry Invariant 3:** Every non-caller participant `i, j` in a settled call achieves identical basis-point return within `<= 1 lamport` integer rounding.
