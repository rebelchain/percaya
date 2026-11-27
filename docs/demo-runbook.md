# Sunday Live Demo Runbook (`percaya` — Dev3pack Hackathon)

One-page operator checklist to run a clean, zero-hitch 3-minute live demo across **WSL (Backend + Devnet)**, **PowerShell Windows (Expo Metro)**, and **Android Studio Emulator (`Medium_Phone_API_37.0`)**.

---

## 1. Pre-flight check (10 minutes before recording)

1. **WSL Terminal 1 — Start Live Solana Devnet API & Auto-Keeper (`DATA=chain`):**
   ```bash
   cd /home/rebel/.gemini/antigravity/scratch/percaya
   npm run dev:api:chain
   ```
   Wait until you see:
   ```text
   [percaya-api] listening on http://localhost:8787 (mode=chain)
   [devnet-sync] calls=1 callers=1 tokens=4
   ```

2. **WSL Terminal 2 — Start Calm Web Preview (optional, for browser Blink/preview shot):**
   ```bash
   cd /home/rebel/.gemini/antigravity/scratch/percaya
   npm run dev:web
   ```
   Verify `http://localhost:5173` loads cleanly in Chrome.

3. **Android Studio (Windows) — Boot Emulator & Devnet Wallet:**
   - Open **Device Manager** → Start **`Medium_Phone_API_37.0`**.
   - Ensure **Solflare** (or **Phantom**) is installed on the Emulator, switched to **Solana Devnet**, and funded with `>= 0.5 SOL` Devnet (`https://faucet.solana.com/`).

4. **PowerShell Windows — Sync Repo & Launch `percaya` on Emulator:**
   ```powershell
   cd D:\Projects\percaya
   git pull origin main
   cd apps\mobile
   npx expo start --dev-client
   ```
   Press **`a`** to open `percaya` on the Emulator. Confirm the top bar pill reads **`● Devnet Live`** and **Call #1 (`$tBONK`)** is visible.

---

## 2. Live 3-minute demo execution commands

- **Check deployer / keeper SOL balance (WSL):**
  ```bash
  solana balance --url devnet
  ```
- **Open a fresh live Devnet call if needed (WSL):**
  ```bash
  cd /home/rebel/.gemini/antigravity/scratch/percaya
  node --experimental-strip-types scripts/open-demo-call.ts
  ```
- **Trigger a live Devnet `$tBONK` price pump to demonstrate Take-Profit + Auto-Keeper (WSL):**
  ```bash
  cd /home/rebel/.gemini/antigravity/scratch/percaya
  npm run move:price -- --token tBONK --sol 0.15
  ```
- **Flash full automated test suite in terminal (WSL):**
  ```bash
  cd /home/rebel/.gemini/antigravity/scratch/percaya
  cargo test && npm run test:api
  ```

---

## 3. Standalone Release APK Build (for Judges & Solana dApp Store)

```powershell
cd D:\Projects\percaya\apps\mobile\android
.\gradlew assembleRelease
```
Output APK: `D:\Projects\percaya\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`

---

## 4. Emergency Fallbacks (Zero-panic rules)

- **Public Devnet RPC slow / 429 during recording:** Stop `dev:api:chain` and switch instantly to `npm run dev:api` (`DATA=demo`) for full UI walkthrough while showing the already-confirmed Solana Explorer links (`3tJumYzk…` & `2wwPbx8G…`) in Chrome.
- **Metro cache glitch on Windows:** Run `npx expo start --dev-client --clear` and press `a`.
- **Android Emulator not reaching WSL `localhost:8787`:** Confirm `curl.exe http://localhost:8787/api/health` responds in Windows PowerShell (`App.tsx` connects via `http://10.0.2.2:8787`).
