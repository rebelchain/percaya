# `percaya`: Dev3pack Hackathon Write-Up & Demo Script

> One buy. One sale. The same price for everyone.

Submission for **Dev3pack Global Hackathon (27–29 November 2026)**  
**Tracks:** Solana Main Track · Solana Mobile (Seeker) Track

---

## Honest limits first

| What people will ask | The answer |
|---|---|
| **Can a caller buy from a second wallet before the pool?** | Yes. Nothing closes exchange-funded side wallets completely. Their own SOL stake rides the pool's entry price, their bond is slashable with a public on-chain reason, pre-buy wallets on the AMM pool are listed on every call (marking any wallet funded by the caller), and Tiers 1–3 require a hardware-bound Seeker Genesis Token. We make front-running costly and visible, never claim it is impossible. |
| **Can a ruined caller start fresh on a new wallet?** | Not above Tier 0 without buying another physical Seeker phone. `GenesisRegistry` (`[b"genesis", genesis_mint]`) binds one Token-2022 Seeker Genesis NFT to one permanent track record. Rotating accounts inside Seed Vault cannot initialize a clean registry. Unverified wallets stay permanently capped at Tier 0 (`2×` bond, `5%` max fee) and carry an `Unverified wallet` tag. |
| **Can a caller sell before everyone else?** | No. There is one sale instruction for the entire `CallPool`. Anyone may send it—the caller, a participant, or the automated keeper—only when a rule fixed at `open_call` is met, and the Anchor program computes `min_out` on chain. |
| **How do take-profit and stop-loss work without Pyth?** | Long-tail call tokens rarely have oracle feeds. `percaya` records on-chain AMM vault sell quotes (`checkpoint`). A sale requires two checkpoints at least `checkpoint_gap` apart that both satisfy the rule (or agree within `2%` at `max_hold`), preventing single-slot flash pushes from triggering or flooring a sale. |
| **What if the caller never buys, or the token becomes illiquid?** | Anyone triggers `refund` `1:1` after `buy_deadline` (recording `negligent` on the caller's record), or `split` after `hold_until + split_grace` so everyone claims pro-rata SPL tokens with zero caller fee. |
| **Devnet or Mainnet? Real swaps?** | Solana Devnet. Every pool executes real Anchor CPI swaps against constant-product `SOL <-> SPL` vaults (`tBONK`, `tWIF`, `tSKR`) and verifies real SPL Token-2022 `NonTransferable` Genesis mints via Seed Vault Simulator + MWA 2.0 on Android, because Jupiter has no Devnet pools and Mainnet prevents deterministic live TP/SL testing. |
| **Is pooling capital with a profit share legal?** | We make no claim that it is. Pooled capital with a performance fee resembles regulated collective investment schemes (OJK in Indonesia; SEC/MiCA elsewhere). `percaya` is an un-audited hackathon accountability experiment on Solana Devnet. |

---

## Why Solana & why Seeker

`percaya` evolved from an earlier EVM concept (`TrustPool`). Re-architecting natively for **Solana + Solana Mobile Seeker** unlocked three capabilities that were structurally missing before:

1. **Hardware-anchored reputation (`Seeker Genesis Token` + `.skr`).** Reputation systems fail when identities are free. Binding Tiers 1–3 (`5×` to `20×` bond cap) to Seeker's 1-per-device Token-2022 Genesis NFT turns a disposable wallet history into a device-bound track record displayed under human-readable `.skr` handles.
2. **Mobile chat to biometric Seed Vault fill (`Blinks` + `MWA 2.0`).** Crypto calls live on phones in Telegram and X with windows of a few minutes. Sharing a `percaya` call posts a live **Solana Action (Blink)** and **Android App Link**—followers tap once in Telegram and sign the deposit via **Seed Vault** fingerprint without touching a desktop browser or third-party auth wrapper.
3. **Closed-form on-chain reserve checks at sub-cent fees.** Recording spaced on-chain checkpoints every 45 seconds—and letting any mobile user or keeper settle the pool for a `0.1%` reward—costs fractions of a cent on Solana, with exact `O(1)` `u128` price-impact caps (`<= 2%`).

---

## What is built

- **`programs/percaya` & `programs/percaya_amm` (Anchor / Rust):** Pooled SOL calls, immutable `CallRules`, closed-form `<= 2%` impact cap, spaced checkpoint verification, profit-only fee math, dust-free final claim sweep, `GenesisRegistry` Token-2022 hardware gate, and LiteSVM/Anchor unit + conservation invariant tests (including both worked examples to the single lamport).
- **`apps/mobile` (Expo React Native Android APK):** Calm daylight interface (`#F2F5F7` / `#1F6E9C` / tabular `Geist Mono`), MWA 2.0 connection + Sign-In With Solana (SIWS), Seed Vault Simulator signing, `.skr` & Seeker Genesis verification, 3-step call wizard, and permissionless Checkpoint / Sell / Claim bottom sheets.
- **`apps/api` (Bun + Hono + Drizzle + Postgres/PGlite):** Real-time Anchor indexer, `PriceSampler`, simulating `Keeper`, `EarlyBuyers` pre-swap funding detector, Solana Actions/Blinks (`ACTIONS.json` + `/api/actions/call/:id` + dynamic `@resvg` PNG cards), SSE live alerts, and Telegram channel announcer.
- **`apps/web` (Vite + React):** Fast shareable call preview, Android App Link router, and live `/docs` reading parameters directly from `GlobalConfig` on Solana Devnet.

---

## 3-minute live demo choreography (Sunday submission video)

Designed for zero dead air and 100% live Devnet verification:

1. **`0:00 – 0:25` · The Problem & Hardware Identity (`Vault` tab on Android)**  
   Show `budi.skr` connected via **MWA 2.0 + Seed Vault Simulator** on Android. Point out the `0.50 SOL` slashable bond, `Seeker Genesis Linked` Token-2022 hardware badge (`Tier 1 · 5× cap`), and a past losing call (`−30.07%`) sitting openly on the same un-erasable record.
2. **`0:25 – 0:55` · Opening an Immutable Call (`+ Open` wizard -> Telegram Blink)**  
   Open a call on `$tBONK` (`2 min` window, `TP +20%`, `SL −15%`, `Max Hold 10m`, `10%` profit share, `0.10 SOL` caller stake). Sign via **Seed Vault**. Show the instant Telegram post & **Solana Blink / Web Preview** card.
3. **`0:55 – 1:30` · Follower Joins via Deep Link / MWA (`Call Detail`)**  
   Switch to follower wallet (`rina.skr`) on Android (or Blink preview), tap the call link, inspect `Fixed at open` rules and live `2%` impact bar, deposit `0.20 SOL` (`total_in = 0.30 SOL`). Show that caller cannot withdraw.
4. **`1:30 – 2:05` · One Pooled Buy (`Holding`)**  
   Window closes. Caller taps **Buy for Pool** -> single CPI swap executes on Solana Devnet. Both caller and follower now hold the exact same entry price.
5. **`2:05 – 2:40` · Price Move, Spaced Checkpoints & Keeper Auto-Sale (`Settled`)**  
   Run `bun scripts/move-price.ts --token tBONK --pump 25` in terminal split-screen. Watch **Auto-Keeper** (or live mobile button) record `Checkpoint 1` and `Checkpoint 2` (`45s` gap), then automatically execute `sell()`, push a live SSE/Telegram alert, and settle at **`+21.4%` net** for both `budi.skr` and `rina.skr`.
6. **`2:40 – 3:00` · Pro-Rata Claim & Permanent Record**  
   Tap **Claim SOL** via Seed Vault. Show `budi.skr`'s on-chain `CallerRecord` increment `settled` with the exact net return—proving one entry, one exit, and hardware-bound consequence.
