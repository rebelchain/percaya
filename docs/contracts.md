# Smart Contract Design Specification (`Anchor 1.2.2 / Rust`)

`percaya` consists of two Anchor programs (`anchor-lang 1.2.0`, compiled with Solana CLI `4.1.2` / SBF `v1.57`) deployed live on **Solana Devnet**:
1. **`percaya`** (`8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6`) — Core pooled-call state machine, immutable rule enforcement, caller bonding, hardware-bound Token-2022 Seeker Genesis registry, and pro-rata settlement.
2. **`percaya_amm`** (`AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz`) — Constant-product (`x * y = k`) `SOL <-> SPL` liquidity pool program implementing exact `u128` quote/impact math and raw SPL Token / Token-2022 `TransferChecked` & TLV parsing.

---

## 1. Solana design principles & EVM migration decisions

1. **Bounded fixed-size PDAs instead of unbounded mappings/arrays.**  
   Per-user participation is isolated into a fixed-size **`Position` PDA** (`[b"position", call_id, participant]`) so `CallPool` stays `O(1)` in space and compute regardless of participant count.
2. **0-byte `SystemAccount` vault PDAs (`SolVault`, `BondVault`, `AmmSolVault`).**  
   In Solana's runtime, `system_program::transfer` reverts if the `from` account carries program data or is not owned by `system_program::ID`. By keeping `SolVault`, `BondVault`, and `AmmSolVault` as **0-byte `SystemAccount` PDAs** funded with `Rent::get()?.minimum_balance(0)` (`890,880` lamports) at creation:
   - Outbound transfers use standard `system_program::transfer` via `CpiContext::new_with_signer`.
   - During `buy`, `percaya` passes `SolVault` as a PDA signer into `percaya_amm::cpi::swap_exact_sol_for_tokens`, and Solana's CPI privilege extension propagates `is_signer` cleanly down into `system_program::transfer`.
   - Accounting relies strictly on state-tracked `total_in`, `payout`, `fee`, and measured `after_lamports - before_lamports` deltas—so unsolicited external lamport transfers (`DirectTransfer` griefing) never distort pro-rata shares or breach rent exemption.
3. **Zero `init_if_needed` (explicit initialization paths).**  
   To eliminate re-initialization audit footguns, account creation uses dedicated `init` instructions (`register_caller`, `register_token`, `init_position`) that clients compose atomically with `post_bond` or `deposit` inside a single `VersionedTransaction`.
4. **Zero external SPL crate bloat (`spl_compat.rs`).**  
   `percaya_amm::spl_compat` parses standard 82-byte Mint accounts, 165-byte Token accounts, Token-2022 TLV extensions (`ExtensionType::NonTransferable == 9`), and invokes `TransferChecked` (tag `12`) directly for both `Tokenkeg…` and `TokenzQd…`, keeping `Cargo.lock` 100% aligned with `Rust 1.89.0` and `LiteSVM 0.15.0`.

---

## 2. Program 1: `percaya` — Account layouts & PDA seeds

All multi-byte integers are little-endian. `BPS_DENOMINATOR = 10_000`.

### 2.1 `GlobalConfig`
- **Seeds:** `[b"config"]` · **Space:** `8 + GlobalConfig::INIT_SPACE`

```rust
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
```
*Live Devnet demo defaults (`F559AB2MjAZModvfDw9oqqpy8gNEuS3AFYZbFTii8aa7`):* `min_bond = 0.05 SOL`, `min_pool = 0.01 SOL`, `window = 60s..600s`, `buy_grace = 600s`, `hold = 120s..1800s`, `checkpoint_gap = 45s`, `split_grace = 600s`, `bond_cooldown = 300s`, `stop_loss_bps = 100..9000`, `min_caller_bps = 500`, `max_impact_bps = 200`, `sell_tolerance_bps = 200`, `keeper_bps = 10`.

### 2.2 `AllowedToken`
- **Seeds:** `[b"allowed_token", token_mint.key().as_ref()]` · **Fields:** `token_mint: Pubkey`, `amm_pool: Pubkey`, `allowed: bool`, `bump: u8`.

### 2.3 `CallerRecord` & `BondVault`
- **`CallerRecord` Seeds:** `[b"caller", caller.key().as_ref()]`
- **`BondVault` Seeds:** `[b"bond_vault", caller.key().as_ref()]` — **0-byte `SystemAccount` PDA** (rent floor funded at `register_caller`).
- **Fields:** `caller`, `genesis_mint`, `is_seeker_verified`, `bond_lamports`, `withdraw_ready_at`, `settled`, `losses`, `negligent`, `refunded`, `split`, `slashes`, `active`, `last_active`, `sum_net_bps`, `bump`, `bond_vault_bump`.

### 2.4 `GenesisRegistry` (Seeker Hardware Anti-Burner Gate)
- **Seeds:** `[b"genesis", genesis_mint.key().as_ref()]`
- **Fields:** `genesis_mint: Pubkey`, `bound_caller: Pubkey`, `slashed: bool`, `bump: u8`.
- **Invariant:** Initialized once with `init` (never closed). Re-submitting the same `genesis_mint` from a second wallet fails with `AccountAlreadyInUse`.

### 2.5 `CallPool` & `SolVault`
- **`CallPool` Seeds:** `[b"call", call_id.to_le_bytes().as_ref()]`
- **`SolVault` Seeds:** `[b"sol_vault", call_id.to_le_bytes().as_ref()]` — **0-byte `SystemAccount` PDA** (rent floor + caller stake funded at `open_call`).
- **`call_token_vault`:** SPL Token / Token-2022 account owned by `CallPool` PDA for `token_mint`.
- **Thesis field:** `#[max_len(280)] pub thesis: String` (4-byte Borsh length prefix + up to 280 UTF-8 bytes, validated in `open_call`).

### 2.6 `Position`
- **Seeds:** `[b"position", call_id.to_le_bytes().as_ref(), participant.key().as_ref()]`
- **Fields:** `call_id: u64`, `participant: Pubkey`, `deposited: u64`, `claimed: bool`, `bump: u8`.

---

## 3. Program 1: `percaya` — Instructions (17 total, zero `init_if_needed`)

| Instruction | Signer | Key checks & state transitions |
|---|---|---|
| `initialize_config(params, genesis_authority, treasury)` | `admin` | Validates all parameter bounds (`keeper_bps <= 100`, `stop_loss 1%..90%`, etc.). Sets `next_call_id = 1`. |
| `update_params(params)` / `set_pause(paused)` | `admin` | Affects future calls only; active pools are untouched. |
| `transfer_admin(new_admin)` / `accept_admin()` | `admin` / `pending_admin` | Two-step admin handover. |
| `register_token(allowed)` / `set_token_allowed(allowed)` | `admin` | Creates (`init`) or toggles `AllowedToken` PDA binding `token_mint <-> amm_pool`. |
| `register_caller()` | `caller` | Creates (`init`) `CallerRecord` PDA and funds `BondVault` 0-byte `SystemAccount` with `Rent::minimum_balance(0)`. |
| `post_bond(amount)` | `caller` | Transfers `amount` lamports into `BondVault`, resets `withdraw_ready_at = 0`, requires `bond_lamports >= min_bond`. |
| `verify_seeker_genesis()` | `caller` | Verifies Token-2022 `NonTransferable` TLV extension (`ext_type == 9`), `decimals == 0`, `mint_authority == Some(config.genesis_authority)`, and `amount == 1` owned by `caller`. Creates (`init`) `GenesisRegistry`. |
| `request_bond_withdraw()` / `withdraw_bond(amount)` | `caller` | Requires `active == 0` and elapsed `bond_cooldown`; transfers from `BondVault` via `invoke_signed`. |
| `slash(amount, reason)` | `admin` | Transfers `min(amount, bond_lamports)` from `BondVault` to `treasury`, increments `slashes += 1`, and sets `GenesisRegistry.slashed = true` (byte offset `72`) when `is_seeker_verified`. |
| `open_call(args)` | `caller` | Snapshots immutable `CallRules` into `CallPool`, enforces live tier (`0..=3`), `share_bps <= tier_max`, `stake <= cap`, and `impact_bps <= max_impact_bps`. Funds `SolVault` (`rent + stake`) and initializes caller `Position`. |
| `init_position()` | `participant` | Creates (`init`) empty `Position` PDA for an `Open` call. |
| `deposit(amount)` | `participant` | Enforces `Open`, `now < window_end`, `new_total <= cap`, `caller_stake >= 5%` of `new_total`, and `impact_bps <= 2%`. |
| `withdraw(amount)` | `participant` | Enforces `Open`, `now < window_end`, `participant != call.caller` (`CallerCannotWithdraw`), `1:1` refund from `SolVault`. |
| `buy(min_tokens_out)` | `caller` | Enforces `window_end <= now <= buy_deadline`, `allowed`, `min_pool <= total_in <= cap`, `>= 5%` caller stake, `<= 2%` impact. CPIs `percaya_amm::swap_exact_sol_for_tokens` signed by `SolVault` PDA; measures real `call_token_vault` balance delta. |
| `checkpoint()` | `any` | Rate-limited by `checkpoint_gap`. Computes `quote_sell` from live `AmmPool` reserves and shifts `prev = last; last = quote`. |
| `sell()` | `keeper` (any) | Requires two valid spaced checkpoints meeting TP (`1`), SL (`2`), or MaxHold agreement (`3`). Computes `min_out` on chain, CPIs `percaya_amm::swap_exact_tokens_for_sol` signed by `CallPool` PDA into `SolVault`, pays `0.1%` keeper reward, computes profit-only caller fee, updates `CallerRecord`, sets `Settled`. |
| `refund()` / `split()` | `any` | `refund` handles `< min_pool` (no fault) or missed `buy_deadline` (`negligent` unless delisted). `split` unlocks pro-rata token claims past `hold_until + split_grace`. |
| `claim()` | `participant` | Once per `Position`. Transfers SOL (`Settled`/`Refunded`) or SPL tokens (`Split`). When `claims_left == 1`, sweeps `pot - claimed_amount` for zero stranded dust. |

---

## 4. Program 2: `percaya_amm` — Closed-Form `u128` Math

Given reserves $R_{\text{sol}}$, $R_{\text{tok}}$ (`u128`) and swap fee $f = \text{fee\_bps}$ (`30` bps):

$$\Delta_{\text{in,net}} = \Delta_{\text{sol}} \times (10000 - f)$$

$$\text{quote\_buy}(\Delta_{\text{sol}}) = \left\lfloor \frac{R_{\text{tok}} \times \Delta_{\text{in,net}}}{R_{\text{sol}} \times 10000 + \Delta_{\text{in,net}}} \right\rfloor \qquad \text{impact\_bps}(\Delta_{\text{sol}}) = \left\lceil \frac{\Delta_{\text{in,net}} \times 10000}{R_{\text{sol}} \times 10000 + \Delta_{\text{in,net}}} \right\rceil$$

$$\text{max\_impact\_sol} = \left\lfloor \frac{R_{\text{sol}} \times \text{max\_impact\_bps} \times 10000}{(10000 - \text{max\_impact\_bps}) \times (10000 - f)} \right\rfloor$$

---

## 5. Verified LiteSVM Test Suite (`programs/percaya/tests/test_percaya.rs`)

All 4 end-to-end tests pass against compiled `.so` binaries in `0.52s` (`cargo test`):
1. `test_full_pooled_call_profit_symmetric_returns_and_dust_sweep` — Proves caller cannot withdraw, single-checkpoint sell reverts, spaced TP sell pays `0.1%` keeper reward, non-caller participants receive identical bps returns, and `SolVault` ends at exact `rent_min(0)` (zero stranded lamports).
2. `test_loss_charges_zero_fee_and_stray_lamport_donation_is_harmless` — Proves unsolicited `system_program::transfer` donations to `SolVault` do not corrupt accounting, stop-loss charges `0` caller fee, and `CallerRecord.losses` increments.
3. `test_seeker_genesis_token2022_hardware_gate_and_slash_permanence` — Proves real 170-byte Token-2022 `NonTransferable` mint verification, blocks a second burner wallet from reusing the same `genesis_mint`, and proves `slash` transfers bond to `treasury` and permanently locks caller at Tier 0.
4. `test_negligent_refund_and_token_split_safety_nets` — Proves negligent refund `1:1` past `buy_deadline` and pro-rata SPL token `split` with zero remaining vault atoms.
