# Security Self-Review (`percaya` on Solana)

**Date:** 27 November 2026  
**Scope:** `programs/percaya`, `programs/percaya_amm`, `apps/api/src/siws.ts`, `apps/api/src/actions.ts`, `apps/api/src/devnet-sync.ts`  
**Status:** Internal self-review + automated `LiteSVM` adversarial test suite (`4/4` passing). **No external security audit has been performed; do not deploy with real user capital on Mainnet before an independent audit.**

---

## 1. On-chain defenses verified in `programs/percaya` & `programs/percaya_amm`

| Threat vector | Mitigation in code | Verification |
|---|---|---|
| **PDA spoofing / wrong authority** | Every PDA (`GlobalConfig`, `AllowedToken`, `CallerRecord`, `BondVault`, `GenesisRegistry`, `CallPool`, `SolVault`, `Position`, `AmmPool`, `AmmSolVault`) enforces canonical `seeds`, `bump`, and `has_one` / `address` constraints in Anchor `#[derive(Accounts)]`. | Compiler + LiteSVM |
| **Account re-initialization (`init_if_needed`)** | Zero usage of `init_if_needed` anywhere in the workspace. All creations use explicit `init` instructions (`register_caller`, `register_token`, `init_position`, `verify_seeker_genesis`) composed atomically in one transaction. | Code inspection |
| **Stray lamport griefing & rent-exemption breach** | `SolVault`, `BondVault`, and `AmmSolVault` are 0-byte `SystemAccount` PDAs seeded with `Rent::get()?.minimum_balance(0)`. Payout math uses state fields (`total_in`, `payout`, `fee`) and measured `after - before` lamport deltas around `sell` CPI—never raw `vault.lamports()`. | `test_loss_charges_zero_fee_and_stray_lamport_donation_is_harmless` |
| **Integer overflow / precision loss** | Workspace `[profile.release]` enables `overflow-checks = true`; all share, fee, impact, and AMM reserve multiplications widen to `u128` / `i128` with `checked_mul`/`checked_add`/`checked_sub`. | `cargo test` + `math.test.ts` |
| **Unreliable swap return values / fee-on-transfer tokens** | `buy` reloads `call_token_vault` balance delta via `spl_compat::parse_token_account`; `sell` measures actual `SolVault` lamport delta; `percaya_amm::swap_exact_tokens_for_sol` measures actual incoming token delta before quoting SOL output. | `programs/percaya/src/lib.rs` |
| **Single-slot flash loan / sandwich sell trigger** | `sell()` enforces `prev.at != 0`, `last.at - prev.at >= checkpoint_gap`, and `now - last.at <= checkpoint_gap`, plus `sell_tolerance_bps` agreement at `max_hold`, and computes `min_out` on chain from the lower checkpoint. | `test_full_pooled_call_profit_symmetric_returns_and_dust_sweep` |
| **Caller front-exit or stake dilution** | `withdraw()` rejects `participant == call.caller` (`CallerCannotWithdraw`); `deposit()` and `buy()` both enforce `caller_stake * 10_000 >= total_in * min_caller_bps` (`5%`). | `test_full_pooled_call_profit_symmetric_returns_and_dust_sweep` |
| **Stranded lamport or token dust** | On `claim()`, the final claimant (`claims_left == 1`) sweeps exact `pot - claimed_amount`. | `SolVault == rent_min(0)` & `call_token_vault == 0` assertions |
| **Fake Seeker Genesis NFT / burner wallet reset** | `verify_seeker_genesis()` parses Token-2022 TLV bytes directly (`spl_compat::parse_mint`), requiring `owner == TOKEN_2022_ID`, `ExtensionType::NonTransferable == 9`, `decimals == 0`, `mint_authority == Some(config.genesis_authority)`, and `amount == 1` owned by `caller`. `GenesisRegistry` uses one-time `init` per `genesis_mint`. | `test_seeker_genesis_token2022_hardware_gate_and_slash_permanence` |
| **CPI privilege extension safety** | `SolVault` (0-byte `SystemAccount`) signs `buy` CPI into `percaya_amm`; `CallPool` signs `sell` CPI into `percaya_amm` while `sol_recipient` is strictly constrained to `sol_vault`. Admin has zero instruction path to `SolVault` or `call_token_vault`. | LiteSVM full buy + sell CPI tests |

---

## 2. Off-chain API & Auth defenses (`apps/api`)

- **SIWS Ed25519 verification (`siws.ts`):** Uses Node 24's native `crypto.verify` over ASN.1 DER SPKI keys, enforces single-use expiring nonces (5 min TTL) and pubkey binding inside the signed message, and compares HMAC session signatures via `crypto.timingSafeEqual`.
- **Simulating Keeper (`devnet-sync.ts`):** Simulates every `checkpoint`, `sell`, `refund`, and `split` transaction via `conn.simulateTransaction` before broadcasting so failed transactions do not burn keeper SOL.
- **Blink validation (`actions.ts`):** Re-validates deposit amount, bond cap, `5%` caller stake ratio, and `2%` buy price impact before constructing unsigned `VersionedTransaction`s.

---

## 3. Accepted hackathon limits (Documented openly)

1. **Single admin key (`GlobalConfig.admin`):** Controls `register_token`, future `ProtocolParams`, `set_pause`, and `slash` (two-step `transfer_admin` / `accept_admin` is implemented; a multisig/Squads authority should replace the EOA before any Mainnet deployment).
2. **In-memory API store in `DATA=chain`:** On-chain state is always authoritative and re-hydrated from Devnet PDAs every 15s, but off-chain thread replies and follows live in memory until PostgreSQL persistence is added post-hackathon.
3. **Token-2022 transfer-fee tokens > 2%:** Tokens whose transfer fee exceeds `sell_tolerance_bps` (`2%`) cannot clear `sell()` against AMM quotes and will fall back to `split()`. Keep high-fee tokens off `AllowedToken`.
4. **Spaced spot checkpoints vs TWAP:** Defeats single-slot manipulation; a well-capitalized actor holding an artificial AMM price across the full `checkpoint_gap` can still trigger a rule.
