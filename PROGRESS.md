# `percaya` — Hackathon Build Progress & Checklist

Living execution tracker for **Dev3pack Global Hackathon (27–29 Nov 2026)**.

---

## Phase 1: Foundation, Smart Contracts & Core Math (DONE)
- [x] Research `dev3pack.xyz`, `docs.solanamobile.com`, and `youvandra/trustpool`
- [x] Author repo-ready documentation (`README.md`, `docs/prd.md`, `docs/contracts.md`, `docs/architecture.md`, `docs/design.md`, `docs/writeup.md`)
- [x] Implement `percaya_amm` Anchor constant-product AMM + closed-form `u128` 2% impact math (`AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz`)
- [x] Implement `percaya` Anchor pooled-call & Token-2022 `GenesisRegistry` program (`8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6`)
- [x] Pass 4/4 LiteSVM tests (worked profit symmetry + dust sweep, zero-fee loss + stray lamport griefing, Seeker Genesis anti-burner + slash permanence, negligent refund & token split)
- [x] Build `@percaya/core` (`6/6` math tests) + sync Anchor IDLs

## Phase 2: API, Blinks, Web Preview & Threads Mobile UI (DONE)
- [x] Implement `@percaya/api` (`Hono`, SIWS Ed25519 auth without Privy, `ACTIONS.json` + Blink `VersionedTransaction`, SVG cards, SSE stream, Android `assetlinks.json`)
- [x] Add Skin-in-the-Game Thread Replies (`GET/POST /api/calls/:id/replies` with automatic `In Pool` vs `Spectator` tagging, `3/3` API tests passing)
- [x] Build `@percaya/web` calm preview (`/`, `/c/:id`, `/docs`, Vite production build passing)
- [x] Build `@percaya/mobile` 5-tab Threads-style Android app (`For you` / `Following`, vertical thread connectors, functional action bar, Caller Profile `Calls / Record / Slashes`, MWA 2.0 + Seed Vault hook)
- [x] Verify on Windows Android Studio Emulator (`Medium_Phone_API_37.0`) and push to `github.com/rebelchain/percaya`

---

## Phase 3: Solana Devnet Deployment & Seeding (DONE)
- [x] Configure Solana CLI Devnet deployer wallet (`68XA2EopzsaZxtHbDxr7gey1eHBBvQDX4D9vTkW44y2i`) & fund with Devnet SOL
- [x] Deploy `percaya_amm.so` (`AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz`) and `percaya.so` (`8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6`) to Solana Devnet
- [x] Seed `GlobalConfig` (`F559AB2MjAZModvfDw9oqqpy8gNEuS3AFYZbFTii8aa7`), 3 SPL tokens (`tBONK`, `tWIF`, `tSKR`) + 3 AMM pools, and Token-2022 `NonTransferable` Seeker Genesis NFT (`GsRTNhTYJg4RG7NgJ8enT1wGAvEfghhchjy25f8WmBLL`)
- [x] Verify live `scripts/move-price.ts` swap against Devnet `$tBONK` AMM (`tx: 2wwPbx8G...`)

## Phase 4: Live Chain Mode (`DATA=chain`) — Indexer, Keeper & Mobile Tx Wiring (DONE)
- [x] Implement `apps/api/src/devnet-sync.ts` (live Anchor PDA Indexer + simulating Auto-Keeper for `checkpoint`, `sell`, `refund`, `split`)
- [x] Implement `apps/api/src/tx-builders.ts` (atomic auto-bundled `register_caller + post_bond + open_call`, plus `checkpoint`, `sell`, `claim`)
- [x] Open live Devnet Call #1 (`tx: 3tJumYzk…`) & verify `DATA=chain` decoding (`$tBONK`, `callerSeekerVerified: true`, `liveCapLamports`)
- [x] Wire `apps/mobile` to live `API_BASE` (`● Devnet Live` via `adb reverse tcp:8787`, pull-to-refresh, transparent Bond vs Stake breakdown)
- [x] Install Solflare Devnet MWA Wallet on Android Emulator, fund `0.5 SOL` (`tx: 59RfkAWh…`), sign live Devnet Call #2 & Call #3 (`tx: 2oY9YPJbS97BBdPsJG…`) via MWA 2.0 `signAndSendTransactions` with Devnet RPC receipt fallback (`ec89c32`)

## Phase 5: Polish, Mas Youvandra Review & Final Submission (IN PROGRESS)
- [x] Sync all repo docs (`README.md`, `contracts.md`, `architecture.md`, `writeup.md`, `security.md`, `demo-runbook.md`, `LICENSE`) with actual stack & live Devnet receipts
- [x] Polish `apps/web` preview with Thread Replies (`In Pool` vs `Spectator` badges), `● Solana Devnet Live` badge & Solana Explorer Devnet links
- [x] Build Standalone Signed Release APK (`cd android && .\gradlew assembleRelease`) and verify sideload install without Metro (live Devnet Sign-in, Detail Thread Reply, and Open Call #3 confirmed end-to-end)
- [ ] Send Review PR & APK to Mas Youvandra and apply review notes
- [ ] Record 3-minute live Devnet demo video and submit on `hack.dev3pack.xyz`
