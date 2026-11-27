# `percaya`: Dev3pack Hackathon Write-Up & Demo Script

> One buy. One sale. The same price for everyone.

Submission for **Dev3pack Global Hackathon (27–29 November 2026)**  
**Tracks:** Solana Main Track · Solana Mobile (Seeker) Track

---

## Honest limits first

| What judges will ask | The honest answer |
|---|---|
| **Can a caller still buy from an unrelated wallet before the pool?** | Yes. Nothing closes exchange-funded side wallets completely. `percaya` puts the caller's own SOL inside the pool at the same entry price, locks a slashable bond with public on-chain reasons, and gates Tiers 1–3 behind a 1-per-device Token-2022 `NonTransferable` Seeker Genesis NFT. Front-running becomes costly and visible, never claimed to be impossible. |
| **Can a ruined caller abandon their history on a fresh wallet?** | Not above Tier 0 without acquiring another physical Seeker device. `GenesisRegistry` (`[b"genesis", genesis_mint]`) is initialized once with `init`; reusing the same `genesis_mint` on a second wallet fails with `AccountAlreadyInUse`, and a slash permanently taints that registry. Unverified wallets remain capped at Tier 0 (`2×` bond, `5%` max fee) and are labelled `Unverified T0`. |
| **Can a caller exit before everyone else?** | No. There is one `sell()` instruction for the entire `CallPool`. Anyone—caller, follower, or the Auto-Keeper—may trigger it once two spaced checkpoints satisfy TP, SL, or Max Hold, and the Anchor program computes `min_out` on chain. |
| **Why spaced spot checkpoints instead of Pyth?** | Long-tail call tokens rarely have Pyth feeds. Two on-chain AMM reserve quotes separated by `checkpoint_gap` (`45s` on Devnet) defeat single-slot flash pushes while working on any constant-product pool. A price held across an entire gap still counts. |
| **Devnet or Mainnet? Real swaps?** | **Solana Devnet.** Both Anchor programs (`percaya` & `percaya_amm`) are deployed live on Devnet with three seeded constant-product pools (`$tBONK`, `$tWIF`, `$tSKR`) and a live Token-2022 `NonTransferable` Genesis mint, because Jupiter has no Devnet pools and Devnet allows deterministic live TP/SL demonstrations. |
| **Is pooling capital with a profit share legal?** | We do not claim it is. Pooled capital with a profit-sharing manager resembles regulated collective investment schemes (OJK in Indonesia; SEC/MiCA elsewhere). `percaya` is an un-audited hackathon prototype on Solana Devnet. |

---

## Why Solana, Seeker & Skin-in-the-Game Threads

`percaya` is built from scratch as a native Android mobile dApp for **Solana + Solana Mobile Seeker**:

1. **Skin-in-the-Game Threads:** Crypto calls live in mobile social feeds, not desktop dashboards. `percaya` adopts a familiar 5-tab **Threads** UX (`Home`, `Callers`, `+ Post`, `Activity`, `Profile`) where **every root post is an on-chain pooled call**—no free shilling—and every reply inside a thread automatically carries an on-chain badge (`In Pool · 0.50 SOL` vs `Spectator`).
2. **Hardware-anchored reputation (`Token-2022 NonTransferable` Seeker Genesis):** Closes the #1 crypto-call loophole (free burner-wallet resets) by binding Tiers 1–3 (`5×` to `20×` bond cap) to a 1-per-device Seeker Genesis NFT via `GenesisRegistry` PDA.
3. **Built for the phone in your pocket (`Camera QR` + `Android Push` + `MWA 2.0`):**
   - **Camera QR Call Scanner & SVG Call QR (`expo-camera` + `react-native-qrcode-svg`):** Scan a caller's QR in person (`percaya://c/:id`) to open locked TP/SL rules and join in one swipe.
   - **Native Android Push Notifications (`expo-notifications`):** Watch or join a call and receive system alerts the moment the pool buys, settles (with signed net return), refunds, or splits.
   - **Zero-Config Cold-Install Devnet RPC (`chain-direct.ts`) + Judge Faucet:** Judges installing `app-release.apk` with Seed Vault, Solflare, Phantom, or Fake Wallet connect immediately to live Solana Devnet PDAs and can claim `0.08 Devnet SOL` in one tap.
4. **Closed-form `O(1)` `u128` reserve math:** Exact constant-product 2% price impact algebra and 0-byte `SystemAccount` vaults that survive stray lamport donations.

---

## Live Solana Devnet deployment

| Component | Live Devnet Address / Tx |
|---|---|
| `percaya` Program | `8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6` |
| `percaya_amm` Program | `AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz` |
| `GlobalConfig` PDA | `F559AB2MjAZModvfDw9oqqpy8gNEuS3AFYZbFTii8aa7` |
| `$tBONK` Mint / AMM Pool | `5Y5uHKfMzJz1VREgJWE8D2vHmxkrTHetzS1uoUebgukR` / `GgTd1UV5SPntSPfsJVEsWafvMk7EWJyQ6i5YwAsNzuiH` |
| `$tWIF` Mint / AMM Pool | `AVdTeM9FEHiBdnPfZ8hKKknkStTxcLrZNkVSRnQoJLDn` / `DTE5Ujr19xh982gGN2h67tdMrYGDpxtsTv1eJaSknxmw` |
| `$tSKR` Mint / AMM Pool | `F1vMDdVFHVwBQBcRW5SgqVHEs8P4ayWTmffhCWBMYyip` / `4XmQwqt8su3HrsSCmtDXx4iXzj3zcMZCkEmdiwUCE4i6` |
| Token-2022 Seeker Genesis NFT | `GsRTNhTYJg4RG7NgJ8enT1wGAvEfghhchjy25f8WmBLL` |
| Live Call #1 (`open_call`) | `3tJumYzkJAXEG344kjWZkDtjngnNzVMdRYgB9SWDjngYT8UFVRMXKEHsRNMfkE3codqx93cTxg15Ebi919bjNBa1` |
| Live Call #3 (MWA 2.0 APK) | `2oY9YPJbS97BBdPsJG…` (signed on standalone `app-release.apk` via Solflare MWA) |
| Live AMM Swap (`move-price`) | `2wwPbx8GJa9Dsh2s5Y9w75i6py5hmqK8KoJUMUdCs9SaT6FCVUGwo5bz2XXXfc8WCoRGu6yx2Zs4F2oQV3n7GmGQ` |

---

## 3-minute live demo script (Sunday submission video)

1. **`0:00 – 0:30` · Problem & Skin-in-the-Game Threads (`Home` & `Profile` tabs on Android Emulator)**  
   Open `percaya` on Android showing the **`● Devnet Live`** indicator and the 5-tab Threads bar (`Home`, `Callers`, `+ Post`, `Activity`, `Profile`). Tap `Profile` to show the caller's SOL bond and **Token-2022 `NonTransferable` Seeker Genesis NFT** (`GsRTNhTY…`). Tap a past settled loss (`−30.07%`) to show the calm, un-erasable record.
2. **`0:30 – 1:05` · Opening an Immutable Call Thread (`+ Post` tab -> Blink Share)**  
   Step through the 3-step Compose Call wizard on `$tBONK` (`TP +20%`, `SL −15%`, `Max Hold 15m`, `5%` profit-only fee, live `<= 2.00%` buy impact check) and sign via **MWA 2.0 / Seed Vault**. Tap `↗ Blink` to show the shareable preview (`/c/:id`) and Solana Action endpoint.
3. **`1:05 – 1:45` · Follower Joins & Replies with Skin-in-the-Game Badge (`Home` -> Thread Detail)**  
   Open live **Call #1 `$tBONK`** from the feed, inspect `Fixed at open` rules, join via MWA 2.0, and post a reply—showing the automatic **`In Pool · X SOL`** badge next to the commenter versus **`Spectator`** for non-depositors.
4. **`1:45 – 2:30` · Live Price Move & Auto-Keeper Spaced Settlement (`WSL Terminal + Emulator`)**  
   In split-screen WSL terminal running `npm run dev:api:chain`, execute:
   ```bash
   npm run move:price -- --token tBONK --sol 0.15
   ```
   Watch `devnet-sync.ts` Auto-Keeper record two spaced checkpoints (`45s` gap) and simulate + send `sell()` automatically on Solana Devnet.
5. **`2:30 – 3:00` · Pro-Rata Claim, QR Scan & Code Rigor (`Activity` + `cargo test`)**  
   Show native Android notification + pull-to-refresh settled net percentage, tap **`QR`** / **`Scan`** to demonstrate phone-to-phone pool handoff, and flash the **19/19** automated test pass (`4/4` LiteSVM + `6/6` core math + `3/3` API + `6/6` mobile QR/notification unit tests).
