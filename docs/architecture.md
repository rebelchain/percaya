# System Architecture & Off-Chain Specification

`percaya` keeps a sharp boundary between **on-chain custody/rules (Anchor)** and **off-chain indexing, social threads, and mobile UX (Node 24 + Hono + Expo RN)**. This document explicitly separates what is **implemented and verified today** from **post-hackathon roadmap items**.

---

## 1. End-to-end topology (Implemented)

```mermaid
flowchart TB
    subgraph Android["Android Device / Emulator (Expo SDK 52 · RN 0.76.7 · Hermes)"]
        App["percaya 5-Tab Threads UI<br/>Home · Callers · + Post · Activity · Profile"]
        MWA["Mobile Wallet Adapter 2.0<br/>@solana-mobile/mobile-wallet-adapter-protocol-web3js"]
        Wallet["Seed Vault / Solflare / Phantom<br/>Biometric Sign + SIWS"]
        App --> MWA --> Wallet
    end

    subgraph Web["Chat & Web Surface"]
        WebApp["Calm Web Preview + /docs<br/>apps/web (Vite 6 + React 18)"]
        Blink["Solana Blinks Clients<br/>/actions.json + /api/actions/call/:id"]
    end

    subgraph API["API & Keeper Host (apps/api · Node 24 + Hono 4.7)"]
        HTTP["REST + Replies + SIWS Auth<br/>Ed25519 via native node:crypto"]
        Act["Solana Actions + SVG Cards<br/>GET/POST /api/actions/call/:id"]
        Sync["Live PDA Indexer (devnet-sync.ts)<br/>15s getProgramAccounts poll"]
        Kpr["Simulating Auto-Keeper<br/>checkpoint · sell · refund · split"]
        SSE["AlertHub (EventEmitter -> SSE + Telegram)"]
        Store[("In-Memory Dual-Mode Store<br/>DATA=demo | DATA=chain")]
    end

    subgraph Chain["Solana Devnet (Live)"]
        Prog["percaya (8ZMPKC79…Ccf6)"]
        AMM["percaya_amm (AzU89s97…quxz)"]
        T22["SPL Token & Token-2022<br/>NonTransferable Genesis NFT"]
    end

    App -- "REST + replies + pull-to-refresh" --> HTTP
    Wallet -- "VersionedTransaction (Devnet)" --> Prog
    WebApp -- "reads" --> HTTP
    Blink -- "metadata + unsigned tx" --> Act
    HTTP --> Store
    Sync --> Store
    Store --> SSE
    Prog -- "memcmp PDA decode" --> Sync
    AMM -- "live reserves" --> Sync
    Kpr -- "simulate -> send" --> Prog
    Prog -- "CPI swap" --> AMM
    Prog -- "TLV verify" --> T22
```

---

## 2. Implemented components (Built & Verified)

### 2.1 Shared Core (`packages/core`, `@percaya/core`)
- Pure TypeScript types (`CallDetail`, `CallerRecord`, `ThreadReply`, `ParticipantPosition`, `ProtocolParams`).
- Exact `BigInt` mirror of on-chain `u128` math (`quoteBuy`, `quoteSell`, `impactBps`, `maxImpactSol`, `computeTier`, `computeSettlement`, `evaluateSellRule`, `computeParticipantClaim`, `formatSolFloor`, `formatSignedPct`) with **6/6 tests passing** (`math.test.ts`).
- Deterministic PDA seed builders (`PDA_SEEDS`) + synced Anchor `1.2` JSON IDLs (`src/idl/percaya.json`, `src/idl/percaya_amm.json`) + live Devnet addresses (`src/devnet-deployment.json`).

### 2.2 Backend API, Indexer & Auto-Keeper (`apps/api`, Node.js 24 + Hono 4.7)
- **Dual-mode store (`DATA=demo` vs `DATA=chain`):**
  - `DATA=demo`: Deterministic fixture calls (`Open`, `Holding`, `Settled` `+26.88%` profit, `Settled` `−30.07%` loss, slashed caller, Seeker-verified callers, and pre-seeded thread replies).
  - `DATA=chain` (`npm run dev:api:chain`): Runs `startDevnetSyncLoop` (`apps/api/src/devnet-sync.ts`) polling Solana Devnet every 15s via `getProgramAccounts` filtered by 8-byte Anchor discriminators, decoding `AmmPool`, `CallerRecord`, `Position`, and `CallPool` Borsh layouts directly into the store.
- **Simulating Auto-Keeper (`devnet-sync.ts`):** When a keeper keypair is present (`KEEPER_SECRET_KEY` or `~/.config/solana/id.json`), automatically simulates and submits `checkpoint()`, `sell()` (when 2 spaced checkpoints qualify), `refund()`, and `split()`.
- **Sign-In With Solana (SIWS, `siws.ts`):** Zero third-party auth SaaS. Verifies 64-byte Ed25519 signatures over canonical SIWS nonce challenges using Node 24's native `node:crypto` and issues `HMAC-SHA256` bearer tokens.
- **Skin-in-the-Game Thread Replies (`GET/POST /api/calls/:id/replies`):** Automatically looks up the commenter's on-chain `Position` for that `callId` and tags the reply with `depositedLamports` (`In Pool · X SOL` vs `Spectator`).
- **Solana Actions / Blinks (`actions.ts`):** Full CORS-compliant `/actions.json`, `GET/POST /api/actions/call/:id` (returns serialized `VersionedTransaction` combining `init_position` + `deposit` after enforcing cap, `5%` caller ratio, and `2%` buy impact), and server-rendered calm SVG cards (`/api/calls/:id/card.svg`).
- **Android App Links (`/.well-known/assetlinks.json`):** Maps `https://percaya.app/c/*` to package `com.percaya.seeker`.
- **Live Alerts (`GET /api/me/stream` + optional Telegram Bot):** SSE stream with heartbeat and optional `TELEGRAM_BOT_TOKEN` push.

### 2.3 Mobile App (`apps/mobile`, Expo SDK 52 · React Native 0.76.7 · Hermes)
- **5-Tab Threads UI (`App.tsx`):** `Home` (`For you (Newest)` & `Following` feeds with vertical thread connectors and inline reply previews), `Callers` (directory + token filter), `+ Post` (3-step immutable call wizard), `Activity` (alerts), and `Profile` (`.skr` identity, Seeker Genesis status, bond).
- **Live Devnet Sync:** Polls `API_BASE` (`http://10.0.2.2:8787` on Emulator) with `RefreshControl` pull-to-refresh and a live status pill (`● Devnet Live` / `● API Demo`), falling back cleanly to demo fixtures when offline.
- **MWA 2.0 + Seed Vault (`src/mwa.ts`):** Uses `@solana-mobile/mobile-wallet-adapter-protocol-web3js` (`chain: 'solana:devnet'`, `sign_in_payload` for 1-prompt SIWS, `signAndSendTransactions`) with `unstable_enablePackageExports = true` in `metro.config.js` and Hermes-safe cloning.
- **dApp Store Ready:** Includes `apps/mobile/dapp-store/config.yaml` and supports standalone local Gradle builds (`./gradlew assembleRelease`).

### 2.4 Web Preview (`apps/web`, Vite 6 + React 18 + Tailwind 3.4)
- Read-only calm preview of `/`, `/c/:id` (with Blink copy + `percaya://c/:id` Android deep link), and live `/docs` reading parameters from `/api/config`.

---

## 3. REST & Actions API surface

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | Public | Mode (`demo`/`chain`), cluster, live Program IDs |
| `GET /api/config` | Public | Live protocol parameters & allowed tokens |
| `GET /api/calls` · `GET /api/calls/:id` | Public | Newest-first calls (`no_ranking`) & full detail |
| `GET /api/calls/:id/replies` · `POST /api/calls/:id/replies` | Public / SIWS | Thread replies auto-tagged `In Pool` vs `Spectator` |
| `GET /api/calls/:id/card.svg` | Public | Calm editorial SVG share/Blink card |
| `GET /api/callers` · `GET /api/callers/:pubkey` | Public | Directory ordered by `lastActive` & full profile |
| `GET /api/auth/nonce` · `POST /api/auth/verify` | Public | SIWS challenge & Ed25519 signature verification |
| `POST /api/me/follow` · `POST /api/me/watch` | SIWS | Follow caller or watch call |
| `GET /api/me/alerts` · `GET /api/me/stream` | Public / SSE | Alert inbox & live SSE stream |
| `GET /actions.json` · `GET/POST /api/actions/call/:id` | Public | Solana Actions / Blinks endpoints |
| `GET /.well-known/assetlinks.json` | Public | Android App Links verification |

---

## 4. Post-hackathon roadmap (Not yet implemented)

To keep the 72-hour build verifiable and honest, the following items are explicitly deferred to post-hackathon sprints:
- **Durable PostgreSQL + Drizzle ORM persistence & advisory locks** (currently in-memory store hydrated from live Devnet PDAs on startup and every 15s; replies reset on API restart).
- **Automated `EarlyBuyers` pre-swap funding scanner** (`getSignaturesForAddress` 1-hop SOL funding trail before `buy_tx_sig`).
- **Raster PNG Blink cards (`@resvg/resvg-js`)** in addition to the live SVG endpoint (`/api/calls/:id/card.svg`).
- **Mainnet Raydium CPMM (`cp-swap`) CPI adapter** replacing `percaya_amm` and **Mainnet AllDomains `.skr` / official Seeker Genesis collection** verification.
- **Council / multisig slashing** in place of the single Devnet admin key.
