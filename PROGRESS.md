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

## Phase 3: Solana Devnet Deployment & Seeding (NEXT)
- [ ] Configure Solana CLI Devnet deployer wallet & fund with Devnet SOL
- [ ] Deploy `percaya_amm.so` and `percaya.so` to Solana Devnet
- [ ] Extend `scripts/seed-devnet.ts` to initialize `GlobalConfig`, mint `tBONK`/`tWIF`/`tSKR`, seed 3 AMM pools, and mint Devnet Token-2022 `NonTransferable` Seeker Genesis NFTs
- [ ] Run `scripts/move-price.ts` against Devnet AMM to verify live price movement

## Phase 4: Live Chain Mode (`DATA=chain`) — Indexer, Keeper & Mobile Tx Wiring
- [ ] Implement `apps/api/src/indexer.ts` (Anchor PDA + log polling into store) and `apps/api/src/keeper.ts` (simulate + send `checkpoint`, `sell`, `refund`, `split`)
- [ ] Wire `apps/mobile` to read live calls/replies from `API_BASE` and build/sign real Devnet Anchor transactions (`open_call`, `deposit`, `buy`, `checkpoint`, `sell`, `claim`, `verify_seeker_genesis`) via MWA 2.0
- [ ] Install Solana Mobile Seed Vault Simulator / FakeWallet APK onto Emulator via `adb install` and verify end-to-end biometric/PIN signing

## Phase 5: Polish, Mas Youvandra Review & Final Submission
- [ ] Add Thread Replies & live `DATA=chain` updates to `apps/web`
- [ ] Configure optional Telegram channel bot token for live demo announcements
- [ ] Send final Review PR to Mas Youvandra and apply review notes
- [ ] Build Standalone Signed Release APK (`cd android && ./gradlew assembleRelease`)
- [ ] Record 3-minute live Devnet demo video and submit on `hack.dev3pack.xyz`
