# Mobile-First Design Specification (`percaya` — Skin-in-the-Game Threads)

`percaya` is a **social network for crypto callers**, modeled directly after **Threads**—with one structural rule that separates it from X or Telegram: **every root post is an immutable on-chain pool**. A caller cannot post a ticker call without locking their own SOL first, and every reply inside a thread automatically displays whether the commenter has skin in the game (`In Pool · 0.50 SOL`) or is a `Spectator`.

**Aesthetic:** *Calm daylight editorial* (`#F2F5F7` / `#FFFFFF` / `#1F6E9C`). Accountability looks unconvincing in a loud casino wrapper. If a call lost `−30.07%`, the post still feels quiet, legible, and honest.

---

## 1. Threads-inspired social architecture

1. **5-Icon Threads Bottom Bar:**
   - **Home (`🏠`):** Vertical thread stream with **`Newest`** (all calls, never ranked) and **`Following`** tabs.
   - **Explore (`🔍`):** Caller directory (ordered by `lastActive`) + token filter chips (`$tBONK`, `$tWIF`, `$tSKR`).
   - **Compose (`+`):** 3-step **Open Call Thread** modal (Token + SOL stake → Exit rules + 280-char thesis → Seed Vault sign).
   - **Activity (`♥` / `🔔`):** Real-time on-chain notifications (`Pool bought`, `Checkpoint 1/2`, `Settled`, `New reply`).
   - **Profile (`👤`):** Your `.skr` identity, Seeker Genesis Token hardware status, active SOL bond, claimable positions, and call history.

2. **Anatomy of a `CallThreadCard`:**
   - **Left gutter:** Deterministic circular caller avatar + **2px vertical thread connector line** (`#E2E8EC`) running down to the latest on-chain update or reply preview.
   - **Header:** `budi.skr` · `Seeker T2` hardware pill (or `Unverified T0`) · relative timestamp (`2m`, `1h`) · `StatePill` (`Open · 4m left`, `Holding`, `Settled +26.88%` / `−30.07%`).
   - **Body:** Plain-English `thesis` + compact **`$tBONK` Embedded Pool Card** (`1.45 / 5.00 SOL` fill bar, `TP +25% · SL −12% · Max 15m · Fee 10% · Fixed at open`).
   - **Functional Anti-Vanity Action Row (replaces empty "Likes"):**
     - `💬 Reply` (opens thread replies)
     - `⚡ Join` / `✓ In Pool` / `Claim` (1-tap Seed Vault action right from the feed)
     - `🔔 Watch` (toggle live SSE/Telegram alerts for this call)
     - `↗ Share Blink` (copies or shares the Solana Action URL)
   - **Inline Thread Preview:** Shows the latest on-chain milestone (e.g., `System · Bought 1.45 SOL at shared entry`) or top participant reply (`rina.skr · In Pool 0.50 SOL: "Clean entry, watching 45s checkpoints"`).

3. **Threads-style Caller Profile (`Calls` · `Record` · `Slashes`):**
   - Header with `.skr` handle, `Seeker Genesis Verified` hardware badge, short bio, active SOL bond, and **Follow** button.
   - Tabbed history: `Calls` (every thread opened), `Record` (net return stats, losses, negligent refunds), `Slashes` (public on-chain slash log).

---

## 2. Design tokens (`#F2F5F7` · `#FFFFFF` · `#1F6E9C`)

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#F2F5F7` | Screen ground |
| `surface` | `#FFFFFF` | Thread cards, bottom nav, sheets |
| `subtle` | `#F6F8FA` | Embedded locked-rules card, reply input well |
| `line` / `line-strong` | `#E2E8EC` / `#CCD5DC` | Thread connector line, hairline dividers |
| `ink` / `ink-2` / `ink-3` | `#0F1D24` / `#364852` / `#66777F` | Primary text/buttons, body, timestamps |
| `accent` | `#1F6E9C` | Brand slate-blue anchor & active `Open` badges |
| `accent-fill` / `accent-soft` | `#DBEAF4` / `#EDF5FA` | Active tabs, `Seeker Genesis` & `In Pool` pills |
| `gain` / `gain-fill` | `#0A8A5F` / `#DCF3E8` | Positive net returns (`+26.88%`) only |
| `loss` / `loss-fill` | `#D23A2F` / `#FDE8E5` | Negative net returns (`−30.07%`) & slashes only |

### Strict product & copy rules
- **No vanity ranking:** Feed is strictly `Newest` or `Following`—never "Trending" or "Top Callers".
- **Tabular numbers (`.num`):** `Geist Mono` / `tabular-nums` on every SOL amount, percentage, and countdown.
- **Explicit signs & floor rounding:** Always `+26.88%` or `−30.07%` (`U+2212`), SOL rounded down.
- **No hype:** Never write *"ape in"*, *"moon"*, *"guaranteed"*, *"win rate"*, or *"move the market"*.
