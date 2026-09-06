# ⚓ Ballast

**A pooled counterparty for DreamDEX event contracts, so the book is never empty.**

DreamDEX's binary markets on Somnia open on schedule, settle correctly and charge zero fees. Across 5,000 settled markets, **83.5% never saw a single trade** — not for want of demand, but because nobody is on the other side. Ballast is a vault that always takes it. *Deposit collateral · quote both sides · stay flat.*

[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
[![somnia](https://img.shields.io/badge/built%20on-Somnia-a855f7)](https://somnia.network)
[![tests](https://img.shields.io/badge/tests-55%20contract%20%C2%B7%2056%20bot-34d399)](#proven-on-testnet)
[![vault](https://img.shields.io/badge/vault-verified%20on%20Shannon-blue)](https://shannon-explorer.somnia.network/address/0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905)

🌐 **[Live app](https://projectballast.vercel.app)** · 📖 **[The spec](./ARCHITECTURE.md)** · 🐛 **[SDK feedback](./FEEDBACK.md)** · 🔎 **[Vault on-chain](https://shannon-explorer.somnia.network/address/0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905)**

> *A market with no ballast capsizes.*

---

## The problem

DreamDEX runs binary Up/Down markets on BTC and ETH — 5-minute, 15-minute and 1-hour windows, settled in USDso, zero fees. The markets roll on schedule and they settle correctly. **The infrastructure is not the problem.**

Across **5,000 settled markets** on mainnet, read from the public indexer:

| | |
| --- | --- |
| Markets that never saw a single trade | **4,175 — 83.5%** |
| Total lifetime volume, all 5,000 | **3,881.75 USDso** |
| Mean volume per market | **0.78 USDso** |
| Busiest market in the venue's history | **100 trades — totalling 0.0058 USDso** |

Reproduce it in thirty seconds:

```sh
curl -s -X POST https://prd.smk.somnia.host/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Market(where:{marketType:{_eq:\"BINARY\"}}, order_by:{tradeCount:desc}, limit:5){ asset intervalSec tradeCount cumulativeQuoteVolume } }"}'
```

And it is worse than thin — it is often **one-sided**. Fresh windows open with a `SELL_YES` ladder and no bids at all. A taker there cannot be filled at any price: you click Up, nothing happens, you leave.

**This is a chicken-and-egg problem whose halves are not symmetric.** Takers will not come to an empty book. Makers will not quote where there is no flow. But **a taker cannot create a market for themselves, while one maker can be the counterparty to everyone.** Only the maker side can be broken unilaterally — and no consumer front end fixes it, because a beautiful app over an empty book still leaves the order unfilled.

---

## What Ballast is

A pot of collateral that is always willing to take the other side.

```
DEPOSIT   n USDso           →  n BALLAST shares
QUOTE     two-sided, strictly inside the book, on every live window
FILL      taker buys YES    →  mint a set, deliver YES, keep NO
          taker buys NO     →  mint a set, deliver NO,  keep YES
FLATTEN   matched YES+NO    →  burnSet back to collateral, riskless
REDEEM    settled position  →  collateral, permissionlessly
WITHDRAW  m shares          →  m × NAV / totalShares
```

It has no view on Bitcoin and predicts nothing. Its only job is to be on the other side, and to keep the two legs it accumulates close to equal.

🔓 **Try it live** — [projectballast.vercel.app](https://projectballast.vercel.app) is open, no login. `/markets` shows the live book and what Ballast charges against it; `/` lets you drag a slider and watch the spread close on a real market; `/app` takes a deposit against the live vault.

---

## Why it is safe to always take the other side

One unit of collateral mints one YES **and** one NO, and that pair is worth exactly one unit at every possible resolution:

| Resolution | YES pays | NO pays | Set |
| --- | ---: | ---: | ---: |
| YES wins | 1 | 0 | **1** |
| NO wins | 0 | 1 | **1** |
| Voided | 0.5 | 0.5 | **1** |

So matched legs carry **no price risk at all**. The vault's entire exposure is the *imbalance* between them, never the size of either — and that is bounded on-chain by a cap the operator key cannot exceed.

Two consequences, both proven in [ARCHITECTURE.md §2](./ARCHITECTURE.md) and asserted in the test suite:

- **Selling YES at `p` is identically buying NO at `1 − p`.** This is why the vault needs no pre-funded inventory and never shorts. The venue's own reference maker cannot do this — `ec-maker` seeds a fixed inventory of **1 share on mainnet** and refuses any order larger than it.
- **A matched pair of fills at bid `b` and ask `a` leaves the vault exactly flat and richer by `a − b`.**

---

## Somnia and DreamDEX, used end-to-end

Ballast is not "an app that happens to run on Somnia" — the strategy is only viable because of what this chain and this venue provide.

| Capability | How Ballast uses it |
| --- | --- |
| **Complete-set mint/burn** (`binaryModule`) | `mintSet` turns collateral into YES + NO on demand, so the vault quotes the sell side with **zero pre-funded inventory** — the single thing that makes always-on two-sided quoting possible |
| **ERC-6909 outcome tokens** | One singleton holds every outcome across every market; the vault's legs are ids on it, not a token per window |
| **CLOB binary pools** (`clobFactory`, `binaryPoolImpl`) | `placeBinaryOrder(kind, …)` posts real resting limit orders inside the book — four order kinds on one book, not an AMM curve |
| **`BinarySettlement` singleton** | `redeem` collects on settled windows, module-routed under settlement-extraction v2 |
| **Sub-second blocks, sub-cent fees** | A quote costs **0.0081 STT** and a cancel **0.00037 STT**. Requoting every 15s across every live window is only economic because of this — see below |
| **Public GraphQL indexer** | Full order book per market with no infrastructure of our own; the dashboard reads it directly and carries no backend |
| **`faucet(uint256)` on tUSDC** | Anyone can fund a testnet wallet and take the other side of Ballast in one click |

**The economics only work on a fast, cheap chain.** A maker's edge here is **one cent per fill**. The quoter refreshes every 15 seconds across every live window, which is thousands of writes a day. Measured on-chain: **208 quotes and 66 cancels cost about 1.7 STT in total.** On a chain with multi-second finality or meaningful gas, the requoting that keeps a quote honest would cost more than the spread it earns, and this strategy simply would not exist.

---

## Proven on testnet

Everything below is live on **Somnia Testnet (chain 50312)** and clickable.

| Artifact | What it proves |
| --- | --- |
| [`BallastVault`](https://shannon-explorer.somnia.network/address/0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905) — verified source | The vault, its cap and its share maths, readable on-chain |
| [Deployment](https://shannon-explorer.somnia.network/tx/0xeb37d81be30e51e95d3c7b4ece7797a64c8ec95ab3f34395089aad51a0dbb31a) | 41,024,732 gas — the Somnia gas note that cost two failed deploys |
| [`placeBinaryOrder` ×208](https://shannon-explorer.somnia.network/tx/0x9070b44c7f5aedf6c04b4c9244d3454c85d33639e6286c1e9ad496356a3b025a) | Real two-sided quotes, posted and repriced against live windows |
| [`cancelOrders` ×66](https://shannon-explorer.somnia.network/tx/0x60fbf6f5fe80176d1e22b260945891221bcb9992ddc765f3ad8db10fd59b2904) | Stale quotes pulled as the book moves |
| [`mintSet` ×15](https://shannon-explorer.somnia.network/tx/0xfffd7f6b7a2451b45fbf5a1611715cdcb1e3a62a363bb27a46c1c3be76d25de1) | Complete sets minted on demand to fill the sell side |
| [`redeem` ×10](https://shannon-explorer.somnia.network/tx/0x2a5add44f6eef1e656c7f1de4e8a4d416295da2a5c498c8feb38adc9f3b0d2ba) | Settled positions cashed permissionlessly |

**300 transactions against the vault, all successful.** That is the quoter running, not a scripted demo.

Current state: **492.81 tUSDC** under management · **50 tUSDC** imbalance cap · price per share **0.9160**.

### Testing

`forge test` — **55 tests**, run at both 6-decimal and 18-decimal bases, each mapped to a numbered invariant in [ARCHITECTURE.md §13](./ARCHITECTURE.md). `pnpm test` in `bot/` — **56 tests** on the pricing and quoting maths.

Then [`test/Adversarial.t.sol`](./test/Adversarial.t.sol), written to **take money out of the vault** rather than confirm it works. Three of its ten tests failed on the first run, and each was a real bug:

| Finding | Severity | Fix |
| --- | --- | --- |
| `redeem` burned an **unresolved** position for zero — anyone could destroy live inventory for free. NAV fell 1000 → 950. | High | Revert when a redemption pays nothing |
| `revokePool` erased NAV — one owner call made 100 of depositor value vanish while the tokens were still held | Medium | `legTotals` counts every pool; revoking stops trading only |
| Unbounded pool list — at 151 pools a deposit cost 1.73M gas, and the venue opens pools every few minutes | Medium | `MAX_POOLS = 64`, with `purgePool` as the pressure valve |

All fixed, all now asserted. The full write-up is in [ARCHITECTURE.md §15b](./ARCHITECTURE.md).

---

## Run it

```sh
# contracts
forge test                      # 55 tests, at both 6dp and 18dp

# see the venue as it is, and what Ballast would post — signs nothing
cd bot && pnpm install
cp .env.example .env
pnpm doctor                     # venue discovery, book depth, one-sided books
pnpm shadow                     # derived quotes + spread compression, no keys needed

# quote for real
pnpm setup --deposit 500 --allow
pnpm quote                      # DRY_RUN=true by default

# the dashboard
cd ../web && npm install && npm run dev
```

`doctor` and `shadow` are read-only and safe to point at mainnet:

```sh
NETWORK=mainnet \
VENUE_ID=0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d \
OPERATOR_ID=5 pnpm doctor
```

---

## Giving something back

Nine SDK and documentation issues found while building, each with a reproduction, in **[FEEDBACK.md](./FEEDBACK.md)**. The three that cost the most time:

- **`placeOrder` always reverts on a binary pool.** The error `UseBinaryPlacement()` is in no public 4-byte database; I found it by computing selectors for all 494 error names in the SDK's ABIs until one matched. The docs list eight sharp edges and this is not among them, though it stops every write dead.
- **Deploying costs ~10× the estimate and fails silently.** 41,024,732 gas actual against forge's ~2.8M estimate — and `forge script --gas-limit` is an alias for `--block-gas-limit`, so it is ignored for the broadcast. Three deploys burned before it was pinned down.
- **`tickSize` and `lotSize` are `null`** on binary market rows, so the grids are not discoverable through the SDK at all and must be configured per network.

---

## Repository

| Path | What |
| --- | --- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The full spec: the proofs, verified addresses, the arithmetic traps, the risk model, the thirteen documented ways this fails silently |
| [`FEEDBACK.md`](./FEEDBACK.md) | Nine SDK/docs issues found while building, with reproductions |
| [`DEPLOYMENTS.md`](./DEPLOYMENTS.md) | Addresses, and the Somnia gas note that cost two failed deploys |
| `src/` | `BallastVault.sol` and the DreamDEX interfaces |
| `test/` | 55 tests, every one mapped to a numbered invariant — including the adversarial suite |
| `bot/` | The quoter, plus `doctor`, `shadow`, `setup`. Vendors `ec-core` |
| `web/` | The dashboard — reads the indexer and the vault directly, no backend |
| `scripts/` | `check-pricing-mirror.sh` — fails if the page and the quoter ever price differently |

---

## Tech stack

- **Contracts** — Solidity, Foundry, solmate. `BallastVault` holds collateral, mints and merges sets, quotes through the venue, and caps its own imbalance.
- **Quoter** — TypeScript, pure Node ESM. A vendored fork of `ec-core` rather than the SDK, because the SDK's registry sweep paginates the entire market registry and times out ([§5.1](./ARCHITECTURE.md)).
- **Arithmetic** — integers end to end. Prices never touch a float; on an 18-decimal venue a float silently lands off the tick grid and the order reverts.
- **App** — Next.js 15 (App Router), wagmi + viem. Reads the GraphQL indexer and the vault over RPC. No backend, no indexer of our own.
- **Quality** — 55 contract tests + 56 bot tests, an adversarial suite, and a script that fails the build if the dashboard and the quoter ever disagree on price.

---

## What this is not

- **Not a prediction engine.** No signal, no forecast, no alpha claim. The reference it quotes around is a spread anchor, not a view.
- **Not a yield product.** Price per share is **0.9160** — the vault is *down*. It may capture spread; on a venue this quiet it may capture nothing, and being everyone's counterparty is how market makers lose money. Any APY claim before real flow exists would be dishonest.
- **Not a market creator.** DreamDEX creates and resolves its own markets; there is no permissionless creation path and Ballast does not attempt one.
- **Not audited.** Testnet only. What it has is eight invariants asserted against a live deployment and an adversarial suite that found three real bugs.

---

## Roadmap

- **Mainnet**, after a professional audit of `BallastVault` — the contract is decimal-agnostic and already tested at 18dp.
- **Multi-operator quoting**, so the vault is not dependent on one key being online.
- **Depositor-facing analytics** — realised spread and adverse selection per market, so the number a depositor sees is earned rather than claimed.
- **Upstream** — the nine issues in `FEEDBACK.md`, contributed back to the SDK and its docs.

---

## Licence

MIT.

🌐 **[Live app](https://projectballast.vercel.app)** · 📖 **[The spec](./ARCHITECTURE.md)** · 🐛 **[SDK feedback](./FEEDBACK.md)** · 🔎 **[Vault on-chain](https://shannon-explorer.somnia.network/address/0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905)**
