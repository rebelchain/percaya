# AI Usage & Human Verification Disclosure

We believe hackathon judges deserve full transparency on how modern developer tools were used in this project.

`percaya` was built during the **Dev3pack Global Hackathon (27–29 November 2026)** using **Google Antigravity** as an AI engineering assistant, under continuous **human direction, code inspection, security review, and live device testing** by **Azhar** and **Youvandra**.

---

## 1. Human Ownership & Review

All product, security, and operational responsibility belongs to the human team:

- **Product & Mechanism Design:** Defined the Skin-in-the-Game Threads model, immutable pool rules, profit-only fee invariants, Token-2022 `NonTransferable` Seeker Genesis hardware gating (`GenesisRegistry`), and Mainnet `$SKR` Buy & Burn alignment.
- **Architecture & Security Review:** Enforced strict Solana safety rules (zero `init_if_needed`, 0-byte `SystemAccount` rent-floor vaults immune to stray lamport donations, closed-form `u128` 2% impact bounds, spaced checkpoint anti-flash guards, and honest `docs/security.md` / `Known limits`).
- **Live Infrastructure & Signing:** Deployed `percaya` and `percaya_amm` to Solana Devnet, provisioned and secured the Oracle Cloud VPS (`https://percaya.duckdns.org` with Nginx + Let's Encrypt TLS + `systemd`), generated the dedicated RSA-2048 release keystore (`apksigner` verified), and published the signed release APK on GitHub Releases.
- **Hands-On Hardware & Wallet Testing:** Verified every user journey manually on Android Studio Emulator and physical Android devices with Solflare MWA 2.0 (including 0-SOL fresh wallet onboarding, Devnet faucet, live Token-2022 SGT binding, 2-wallet Caller + Follower pool joins, Camera QR scanning, and Android notifications).

---

## 2. How Antigravity Was Used

Google Antigravity was used as an interactive pair-programmer for:

- Drafting and iterating on Anchor Rust modules (`programs/percaya`, `programs/percaya_amm`) and `LiteSVM` simulation tests.
- Building TypeScript packages (`packages/core`), Node 24 + Hono API endpoints (`apps/api`), Vite web preview (`apps/web`), and Expo React Native modules (`apps/mobile/src/chain-direct.ts`, `useMobileWallet.ts`, `CallQr.tsx`, `OnboardingGuide.tsx`).
- Debugging Android/Gradle/Metro/MWA edge cases (Hermes `Buffer` polyfill, Solflare post-broadcast MWA WebSocket disconnect fallback, Android API 37 `SafeAreaView` insets).
- Structuring and syncing technical documentation (`README.md`, `docs/*.md`, `PROGRESS.md`).

---

## 3. Zero-Blind-Trust Verification Rule

No AI-generated code was shipped without verification:

1. **Automated Test Gate (`24/24` passing):**
   - `cargo test` (`LiteSVM 0.15`): **4/4** on-chain Anchor E2E tests
   - `packages/core/src/math.test.ts`: **6/6** fixed-point math & settlement invariant tests
   - `npm run test:api`: **4/4** API, Ed25519 SIWS, Solana Blinks & SGT issuance tests
   - `apps/mobile` (`npm run test`): **10/10** QR link parser, notification diff, onboarding checklist & release signing patcher tests
2. **Live Chain & Device Proof:** Every transaction builder (`open_call`, `deposit`, `verify_seeker_genesis`, `checkpoint`, `sell`, `claim`, `refund`) was simulated and/or executed live on **Solana Devnet** with verifiable Explorer receipts.
3. **No Unimplemented Claims:** Documentation was explicitly audited against the live codebase so no README feature is claimed unless it runs in code.
