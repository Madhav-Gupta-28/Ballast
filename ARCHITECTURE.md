# Ballast — Technical Architecture

**Version 1.0 · DreamDEX Event Contracts on Somnia**

> *A market with no ballast capsizes.*

This document is the complete specification for Ballast. Anyone who reads it should be able to rebuild the system from scratch without consulting the author.

Every on-chain fact was read directly from a live RPC, the DreamDEX indexer, or the `dreamdex-bot-kit` source on **2026-09-01**. Facts I could not verify are listed in [§15](#15-open-items) and marked **UNVERIFIED** in the text. Nothing here is assumed.

---

## Table of contents

1. [The primitive](#1-the-primitive)
2. [The mechanism, proven](#2-the-mechanism-proven)
3. [Verified chain facts](#3-verified-chain-facts)
4. [Why this venue needs this thing](#4-why-this-venue-needs-this-thing)
5. [System architecture](#5-system-architecture)
6. [Integer arithmetic, the tick grid and the lot grid](#6-integer-arithmetic-the-tick-grid-and-the-lot-grid)
7. [Market lifecycle](#7-market-lifecycle)
8. [Settlement, claiming and the fee](#8-settlement-claiming-and-the-fee)
9. [The risk model](#9-the-risk-model)
10. [User flows](#10-user-flows)
11. [The thirteen failure modes](#11-the-thirteen-failure-modes)
12. [Threat model](#12-threat-model)
13. [Invariants](#13-invariants)
14. [Test plan](#14-test-plan)
15. [Open items](#15-open-items)
16. [Sources](#16-sources)

---

## 1. The primitive

Ballast is a pooled counterparty for DreamDEX event contracts. It exists so that a person arriving at any live BTC or ETH window gets filled immediately, on a book that would otherwise be empty.

```
DEPOSIT    n USDso            ->  n BALLAST shares
QUOTE      vault posts a two-sided book on every live market
FILL       taker buys YES  ->  vault mints a set, delivers YES, keeps NO
           taker buys NO   ->  vault mints a set, delivers NO,  keeps YES
FLATTEN    matched YES+NO   ->  merged back to collateral, riskless
WITHDRAW   m shares         ->  m * NAV / totalShares USDso
```

The vault never predicts anything. It has no view on Bitcoin. Its only job is to always be on the other side, and to keep the two sides it accumulates as close to equal as it can.

### What is actually new here

Pooled market making is not new. Automated market makers are not new. Three things are specific to this design:

1. **It quotes with no inventory.** On DreamDEX a complete set is mintable on demand — one unit of collateral becomes one YES plus one NO. So the vault never needs to pre-hold outcome tokens to quote the sell side. The venue's own reference maker cannot do this: `ec-maker` seeds a fixed `MM_INVENTORY` of **1 share on mainnet** and refuses any order larger than it ([§11.12](#1112-there-is-no-naked-short)).

2. **Its risk is one scalar, and it is not directional.** A complete set redeems to exactly one collateral whichever way the market resolves. The vault's entire exposure is therefore the *imbalance* between its YES and NO holdings, not the size of either. This is stated in the venue's own source ([§9](#9-the-risk-model)).

3. **It is a liquidity primitive aimed at a venue that has none.** Across 5,000 settled markets, 83.5% never saw a single trade and lifetime volume is about 3,834 USDso ([§4](#4-why-this-venue-needs-this-thing)). Ballast is not competing for flow on a busy book; it is the reason a book exists.

### What this is not

- **Not a prediction engine.** No signal, no forecast, no alpha claim. The fair value it quotes around is a reference point for spread placement, not a view.
- **Not a yield product.** It may capture spread; on a venue this quiet it may capture nothing. Any APY claim before real flow exists would be dishonest. See [§9.4](#94-adverse-selection-is-real).
- **Not a market creator.** DreamDEX creates and resolves its own markets. There is no permissionless creation path and Ballast does not attempt one ([§3.6](#36-market-creation-is-not-permissionless)).

---

## 2. The mechanism, proven

Let `p ∈ (0,1)` be the YES price, quoted as a probability. The venue enforces `price(NO) = 1 − price(YES)` on a single book.

### 2.1 Conservation of the complete set

**Claim.** One complete set is worth exactly one unit of collateral at every resolution, before any fee.

Let the settlement payout of one outcome token be `π(outcome)`.

*Case resolved, YES wins.* `π(YES) = 1`, `π(NO) = 0`. Set value `= 1 + 0 = 1`.
*Case resolved, NO wins.* `π(YES) = 0`, `π(NO) = 1`. Set value `= 0 + 1 = 1`.
*Case voided.* Both sides refund `0.5`. Set value `= 0.5 + 0.5 = 1`.

In all three cases the set is worth exactly 1. **This is the property the whole design rests on.** It is why the vault can hold a matched book with zero risk, and why `mint` and `merge` are always safe operations.

With a settlement fee `f` the resolved cases pay `1 − f` and the void case pays `1` (the venue charges no fee on a void — [§8.2](#82-a-void-pays-both-sides-half)). Today `f = 0` on the live venue ([§3.5](#35-fees-are-currently-zero)), but the vault must not assume it stays there. The consequence is [§8.4](#84-merge-before-expiry-do-not-redeem-after).

### 2.2 Selling YES is buying NO

**Claim.** Minting a set and selling the YES leg at price `p` is economically identical to buying a NO at price `1 − p`.

Track the vault's balance sheet through the operation, in units of collateral:

```
start                      C
mint one set              C − 1,  Y += 1,  N += 1
deliver YES at price p    C − 1 + p,       Y −= 1
```

Net effect: `ΔC = p − 1`, `ΔN = +1`. The vault paid `1 − p` collateral and received one NO token. That is precisely a purchase of NO at `1 − p`. ∎

This is why the vault needs no inventory and no short. Every sale it makes is a purchase of the opposite leg, funded from the pool.

### 2.3 A two-sided fill captures exactly the spread

**Claim.** If the vault quotes YES bid `b` and YES ask `a` with `b < a`, and one taker lifts each side, the vault ends with **zero residual position** and **exactly `a − b`** in collateral.

```
taker buys YES at a:   mint set (ΔC = −1, ΔY = +1, ΔN = +1), deliver YES (ΔY = −1, ΔC = +a)
                       net:  ΔC = a − 1,   ΔN = +1

taker buys NO at 1−b:  mint set (ΔC = −1, ΔY = +1, ΔN = +1), deliver NO (ΔN = −1, ΔC = +1−b)
                       net:  ΔC = −b,      ΔY = +1

combined:              ΔC = a − 1 − b,     ΔY = +1,  ΔN = +1
merge the pair:        ΔC = +1,            ΔY = −1,  ΔN = −1
─────────────────────────────────────────────────────────────
total:                 ΔC = a − b,         ΔY = 0,   ΔN = 0
```

The vault is flat and richer by the spread. ∎

**The corollary that matters operationally:** a one-sided fill leaves the vault holding one unit of the opposite leg. That residual — not the gross position — is the risk, and [§9](#9-the-risk-model) is about bounding it.

### 2.4 Net asset value

Let `C` be collateral held, `Y` and `N` outcome-token balances across all live markets, and `m = min(Y, N)` the matched portion.

```
NAV  =  C  +  m  +  value(|Y − N| units of the longer leg)
```

The first two terms are deterministic. Only the third carries price risk, and it is bounded above by `|Y − N|` (an outcome token can never be worth more than 1) and below by 0. So:

```
C + m  ≤  NAV  ≤  C + m + |Y − N|
```

A vault that keeps `|Y − N| = 0` has a NAV that cannot move. This bound is the basis of the share-price guarantee in [§13](#13-invariants).

---

## 3. Verified chain facts

Every value in this section was read on **2026-09-01** from a live endpoint. Reproduce any of them with the commands given.

### 3.1 Networks

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain ID | `5031` | `50312` |
| Native token | SOMI (18 dp) | STT (18 dp) |
| RPC | `https://api.infra.mainnet.somnia.network` | `https://api.infra.testnet.somnia.network` |
| Indexer (GraphQL) | `https://prd.smk.somnia.host/v1/graphql` | `https://dev.smk.somnia.host/v1/graphql` |
| Explorer | `https://explorer.somnia.network` | `https://shannon-explorer.somnia.network` |

```sh
curl -s -X POST https://api.infra.mainnet.somnia.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# -> {"jsonrpc":"2.0","id":1,"result":"0x13a7"}   0x13a7 = 5031
```

**Block time is 0.1001 s**, measured across an 864,000-block span (24.01 h). This matters: order expiry, requote intervals and claim sweeps are all specified in wall-clock time, not blocks.

> **RPC log retention.** The public RPC serves `eth_getLogs` for roughly the **last 5,000 blocks (~8 minutes)** and returns an *empty array* — not an error — beyond that. Any historical analysis must use the indexer or the Blockscout API. This silently corrupted an earlier measurement during research; see [§15](#15-open-items).

### 3.2 Protocol core (CREATE3 — identical on both chains)

| Contract | Address |
| --- | --- |
| `binaryModule` | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| `marketsCore` | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| `clobFactory` | `0xb2BE8EE02F96379DB75f01802384593EBa9bfF04` |
| `binaryPoolImpl` | `0x82A1FcdaA2daC2fC7D5f9909D43E68021eE966FD` |
| `binarySettlement` | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| `collateralRouter` | `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C` |
| `marketCreatorFactory` | `0xE6bEE93cE87c9E6e62aCb621caa7832EE47b4F6B` |
| `oracleHub` | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |

### 3.3 Per-network values

| | Mainnet | Testnet |
| --- | --- | --- |
| Collateral | USDso `0x00000022dA000002656c64D9eA6011ea952D008A` | tUSDC `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| **Collateral decimals** | **18** | **6** |
| Faucet | none | `faucet(uint256)` on the collateral |
| `marketCreator` | `0x62627805965705Cc303A7F6282DD5059921980aD` | `0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6` |

**The decimal difference between networks is the most likely source of a catastrophic bug in this codebase.** Testnet is 6 dp, mainnet is 18 dp. Every amount must go through `toRawUnits(human, config.decimals)` — never a hardcoded `1e18`. See [§6](#6-integer-arithmetic-the-tick-grid-and-the-lot-grid).

### 3.4 The live venue, and why it drifts

The mainnet venue carrying live markets on 2026-09-01:

```
0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d
```

The `MarketVenue` rows in the indexer, however, describe a *different* venue — `0xcc69885fda6bcc1a4ace058b4a62bf5e179ea78fd58a1ccd71c22cc9b688792f`, operatorId 1. This is not a bug in the query; the kit documents the same divergence:

> *"Do NOT infer the venue from the deployment manifest: on both networks the manifest's 'active' venue disagrees with where the live markets actually are."*
> — `ec-core/src/markets.ts`

Venue ids also **move**: the kit records both networks changing theirs three times in the first week of August 2026. **Ballast must read `venueId` off a live market row at startup and re-derive it whenever the active-market query returns empty**, never pin it in code.

### 3.5 Fees are currently zero

Read from the indexer's `MarketVenue` table:

```graphql
{ MarketVenue { venueId makerFeeBps takerFeeBps settlementFeeBps routingFeeBps maxBuilderFeeBps } }
```

| Fee | Value |
| --- | --- |
| `makerFeeBps` | **0** |
| `takerFeeBps` | **0** |
| `settlementFeeBps` | **0** |
| `routingFeeBps` | **0** |
| `maxBuilderFeeBps` | **0** |

All zero today. **Do not hardcode this.** The pool struct carries `settlementFeeBpsTimes1k` (rates are bps × 1000 on-chain) and the kit reads it at runtime through `settlementFeeBps()`. Ballast does the same, and its accounting is correct for any `f ≥ 0`.

### 3.6 Market creation is not permissionless

There is no SDK method to create or resolve a market, and no public creator entry point. The venue rolls successors automatically on expiry. Ballast is a **taker of the market schedule**, never a creator. It discovers markets, it does not make them.

### 3.7 The product surface

Queried from the indexer across 5,000 indexed BINARY markets:

| | |
| --- | --- |
| Assets | **BTC, ETH** only (2,910 / 2,090 of the sample) |
| Intervals | **900 s** (3,993), **3600 s** (983), **300 s** seen live, plus a handful of irregular values |
| Per-market backing | 1,250 USDso |
| `tickSize` / `lotSize` / `minQuantity` on binary rows | **all `null`** |

The last row is important and is why [§6](#6-integer-arithmetic-the-tick-grid-and-the-lot-grid) exists: **the venue's tick and lot are not discoverable through the API for binary markets.** They must be configured.

---

## 4. Why this venue needs this thing

This section is evidence, not argument. All figures from the mainnet indexer on 2026-09-01, over a 5,000-market sample (the query limit — the true totals may be larger).

| | |
| --- | --- |
| BINARY markets sampled | **5,000** (all finalized, 0 voided) |
| Markets with **zero** trades | **4,174 — 83.5%** |
| Markets with ≥1 trade | 826 — 16.5% |
| Total trades, all markets | **4,754** |
| **Total lifetime volume** | **3,833.91 USDso** |
| Mean volume per market | **0.77 USDso** |

And the busiest markets in the venue's history:

| Asset | Interval | Trades | Volume |
| --- | --- | ---: | ---: |
| BTC | 3600 s | 100 | **0.01 USDso** |
| BTC | 3600 s | 58 | 0.01 USDso |
| BTC | 3600 s | 44 | 0.01 USDso |

> **The single most-traded event-contract market in DreamDEX's history did 100 trades totalling one cent.**

Any judge can reproduce this in thirty seconds against the public indexer. It is the strongest available statement of the problem, and it is the reason the pitch leads with liquidity rather than analytics.

**The asymmetry that follows.** A taker cannot create a market for themselves; a maker can be the counterparty to everyone. One party willing to always quote makes the venue tradeable immediately. No consumer front end can do that — a beautiful app over an empty book still leaves the order unfilled.

---

## 5. System architecture

Ballast is three processes and one contract. The contract holds funds and accounts for shares; the quoter never custodies user money.

```
┌────────────────────────────────────────────────────────────────┐
│  BallastVault.sol                        (Somnia, EVM)         │
│  · deposit / withdraw, ERC-20 share accounting                 │
│  · holds USDso; approves the operator for trading only         │
│  · NAV read; imbalance cap; pause                              │
└───────────────┬────────────────────────────────────────────────┘
                │ operator key (session key — cannot withdraw)
┌───────────────▼────────────────┐  ┌──────────────────────────┐
│  quoter (Node, ec-core fork)   │  │  claimer (same loop)     │
│  · activeMarkets → per market  │  │  · settledMarkets()      │
│  · mint sets on demand         │  │  · redeem winners        │
│  · post two-sided quotes       │  │  · merge matched pairs   │
│  · cancel & requote each cycle │  │  · serialised on one key │
└───────────────┬────────────────┘  └──────────────────────────┘
                │ reads
┌───────────────▼────────────────────────────────────────────────┐
│  web (Next.js)                                                 │
│  · one-tap Up/Down trade surface (the demo)                    │
│  · vault dashboard: NAV, imbalance, fills, share price         │
│  · positions & unclaimed winnings                              │
└────────────────────────────────────────────────────────────────┘
```

### 5.1 Why a fork of `ec-core`, not the SDK

`@somnia-chain/markets-sdk` published **0.20.0 on 2026-08-04** and **0.29.0 on 2026-09-01** — ten releases in 28 days, including two same-day minor bumps. The docs warn that anything below 0.28.0 mis-loads markets and produces off-grid prices.

Ballast therefore **vendors `packages/ec-core`** from `dreamdex-bot-kit` and imports the SDK only through it. `ec-core` already wraps every sharp edge — `placeLimit` for tick conversion, `quantize` for lot sizing, `assertTxOk` for silent reverts. One seam to repair instead of five.

**Pin the exact SDK version in `package.json`, commit the lockfile, and do not upgrade during a build week.**

### 5.2 The vault contract

```solidity
contract BallastVault {
    IERC20  public immutable collateral;   // USDso (18dp) / tUSDC (6dp)
    address public operator;               // quoter key; may trade, may NOT withdraw
    uint256 public totalShares;
    uint256 public imbalanceCapRaw;        // hard bound on |Y − N|, raw units
    bool    public paused;

    function deposit(uint256 amount) external returns (uint256 sharesOut);
    function withdraw(uint256 shares) external returns (uint256 amountOut);
    function nav() public view returns (uint256);         // §2.4
    function sharePrice() public view returns (uint256);  // nav * 1e18 / totalShares
}
```

Share maths, with `d = collateral decimals`:

```
first deposit    sharesOut = amount                      (share price seeded at 1.0)
later deposit    sharesOut = amount * totalShares / nav
withdraw         amountOut = shares * nav  / totalShares
```

Rounding is **always against the caller and in favour of the pool** — `sharesOut` rounds down, `amountOut` rounds down. This makes share price non-decreasing under deposit and withdraw, which is [Invariant 4](#13-invariants).

**The operator cannot withdraw.** It receives an allowance to move collateral into mints and orders only. This mirrors the kit's session-key model: *"run a bot with a hot key that can't withdraw funds."*

### 5.2b The write surface Ballast uses

Verified against `markets-sdk@0.29.0`. Raw tier (`exchange.trader`) takes bigints and pool addresses; the unified tier takes symbols and human units.

| Verb | Purpose |
| --- | --- |
| `trader.mintSet({ pool, amount })` | collateral → equal YES + NO |
| `trader.burnSet({ pool, amount })` | equal YES + NO → collateral |
| `trader.placeOrder({ …, quantity })` | exact-size order, bypasses the float path |
| `trader.redeem({ marketId, amount, outcomeIdx?, market? })` | settled position → collateral |
| `client.getMarketOnchain(marketId)` | authoritative snapshot (pool, nonce, ids, status) |
| `client.getOutcomeBalance({ outcomeToken, account, id })` | ERC-6909 balance |
| `client.listBinaryMarkets({ status: "Finalized" })` | settled markets for claiming |

`redeem` is **module-routed** under settlement-extraction v2: the module pulls the winning tokens, finalizes if needed, and redeems through the `BinarySettlement` singleton. `outcomeIdx` is looked up from `market.winningOutcome()` when omitted — which is why a **void must pass it explicitly** ([§8.2](#82-a-void-pays-both-sides-half)).

### 5.3 The quoter loop

One pass, per live market, in this order. The order is not cosmetic — each step depends on the previous one holding.

```
1  markets = activeMarkets(ctx)                 // venue-scoped; throws if ambiguous
2  for each market:
3      onchain = marketOnchain(ctx, market)     // ONE snapshot, reused all pass
4      if !isTradable(onchain) → skip           // status must be Trading (1)
5      book = snapshot(ctx, yesSymbol)          // best bid / ask / mid
6      fair = referencePrice(market, book)      // §5.4
7      (bid, ask) = fair ∓ halfSpread, clamped, snapped to tick
8      need = quoteSize; ensureSets(need)       // mint only the shortfall
9      cancelStale(market); placeLimit(bid); placeLimit(ask)
10 maybeClaim(ctx)                              // same key, same loop — §8.3
11 mergeMatched()                               // flatten min(Y,N) back to collateral
```

**Never straddle a pool recycle.** Step 3 takes the authoritative snapshot once and every read and write in that pass uses it. The kit is explicit: settlement-extraction v2 recycles a pool's `(nonce → ids)` binding each market, so a pool address is a *time-varying* binding and `getMarketOnchain` must be called with the bytes32 `marketId`, never a raw address.

### 5.4 The reference price

Ballast quotes around a reference, not a forecast. In priority order:

1. **Book mid**, when both sides exist — `(bestBid + bestAsk) / 2`.
2. **One-sided anchor**, when only one side exists — the single resting level, widened.
3. **Underlying-derived prior**, when the book is empty (the common case here). The exchange exposes a BTC/ETH spot and EMA mark feed via `config.priceFeed`. For a window with strike `K`, time-to-expiry `τ` and an EWMA volatility estimate `σ`, the risk-neutral probability that spot finishes above the strike is approximately

   ```
   p ≈ Φ( ln(S/K) / (σ √τ) )
   ```

   where `Φ` is the standard normal CDF. This is a *reference for spread placement*, not a claim of edge. On an empty book it simply prevents the vault quoting somewhere absurd.

4. **Fallback `p = 0.5`** if the feed is unavailable, with the spread widened to the configured maximum.

> **Do not use an LLM here.** A language model is a worse estimator of a 15-minute BTC binary than the closed form above, and a trading-literate judge will identify that immediately. If on-chain AI is wanted later, its honest role is *verifying the pricing inputs*, not producing the price — see [§15](#15-open-items).

---

## 6. Integer arithmetic, the tick grid and the lot grid

This section exists because two of the kit's documented bugs live here, and both fail silently.

### 6.1 Never hand the SDK a float price on an 18-decimal venue

The unified `createOrder` converts price with `parseUnits(price.toFixed(18), 18)`. But `(0.05).toFixed(18)` is `"0.050000000000000003"` — **three wei off the tick grid**, which the pool rejects with `InvalidPrice`.

The kit's measured result on mainnet: **of fifteen ordinary probabilities, only `0.25`, `0.50` and `0.75` survive the round-trip.** A 6-decimal venue never shows this, so **testnet looks clean and mainnet breaks.**

Ballast always uses `placeLimit` from `ec-core`, which converts in tick and lot units as integers and sends through the raw tier.

### 6.2 The grids are not discoverable — they are configured

Binary market rows carry `tickSize: null` and `lotSize: null` (verified, [§3.7](#37-the-product-surface)). The SDK's generic `amountToPrecision` therefore snaps binary sizes to a **whole share**, flooring every sub-unit order to zero. Use `quantize` instead.

| | Mainnet | Testnet |
| --- | --- | --- |
| `MM_TICK` | `1_000_000_000_000_000` (1e15 → 0.001) | `1_000` (→ 0.001) |
| `MM_LOT` | `1_000_000_000_000_000` (1e15 → 0.001 share) | `1` (→ 0.000001, effectively unconstrained) |

`quantize` snaps **down** and returns 0 when the amount is below one lot. **A zero return means skip the leg — never send it.**

### 6.3 Conversions, written out

```
toRawUnits(h, d)  =  BigInt( h.toFixed(d) without the decimal point, right-padded to d )
```

Going through `toFixed` rather than `h * 10**d` is deliberate: it avoids float→BigInt loss on fractional sizes. Three decimal bases are in play across the system:

```
collateral   18 dp on mainnet, 6 dp on testnet
prices       probabilities in (0,1), tick-quantised
shares       18 dp (Ballast's own ERC-20, fixed regardless of network)
```

Ballast's share token is **always 18 dp** so the front end never has to branch on network. The conversion happens once, at the vault boundary.

---

## 7. Market lifecycle

The on-chain `MarketStatus` enum, from `ec-core/src/markets.ts`:

| Value | Status | Orders accepted? |
| ---: | --- | --- |
| 0 | `Listed` | no |
| 1 | **`Trading`** | **yes — the only writable state** |
| 2 | `Locked` | no |
| 3 | `Settling` | no |
| 4 | `Resolved` | no — redeem only |
| 5 | `Voided` | no — redeem only, both sides at 0.5 |

**Gate every write on the on-chain status, never the indexer.** The indexer lags by seconds; `isTradable(onchain)` is `status === 1`. A mint or an order against a market that has just left `Trading` reverts — and the SDK will not tell you ([§11.2](#112-a-reverted-write-does-not-throw)).

Outcome indices are fixed: **YES is outcome 0, NO is outcome 1.**

Outcome balances are **ERC-6909 ids on a shared singleton**, not per-market ERC-20s. Read them with:

```ts
client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account, id: onchain.yesId })
```

Never `balanceOf`. And because pools recycle `(nonce → ids)` per market, always read balances against the same `onchain` snapshot you validated in this pass.

---

## 8. Settlement, claiming and the fee

### 8.1 Winnings are claimed, not received

A settled market pays out **only when asked**. The position does not decay into collateral on its own. The kit's warning:

> *"A bot that trades for a week and never redeems has its balance spread across dozens of finalised markets while its wallet reads near zero."*

This is also the venue's clearest user-facing defect, and Ballast surfaces the fix for humans as well as for itself ([§10.3](#103-the-trader-collecting-winnings)).

### 8.2 A void pays both sides half

On a voided market **both** YES and NO refund `0.5`, and there is no winning outcome to infer. The unified `exchange.redeem()` derives the outcome from `winningOutcome`, which is meaningless on a void — so redemption must go through the raw trader with an **explicit `outcomeIdx`**:

```ts
exchange.trader.redeem({ marketId, market: onchain.marketAddress,
                         outcomeToken: onchain.outcomeToken, outcomeIdx, amount })
```

No fee is charged on a void.

### 8.3 Finding settled markets

`loadMarkets()` **cannot** answer this. Since markets-sdk 0.20 the registry sweep skips finalized binaries, so a settled market simply is not in it. Use the binary tier:

```ts
client.listBinaryMarkets({ venueId, status: "Finalized", limit })
```

Over-fetch and sort locally: the server sorts newest-*created*, but you want newest-*expired*, and those disagree across series of different cadences.

Claiming must run **inside the quoter loop**, not on a timer. It signs from the same key the quoter trades with, and two senders on one key race each other's nonce. Driving it from the loop serialises it for free. **Never run two Ballast processes on one key.**

### 8.4 Merge before expiry, do not redeem after

With settlement fee `f`:

The merge verb is **`burnSet`** — *"surrender equal YES + NO, get collateral back."* Verified in `@somnia-chain/markets-sdk@0.29.0`:

```ts
trader.burnSet({ pool, amount, outcomeToken?, autoApprove? })   // on-chain: burnSet(uint256)
trader.mintSet({ pool, amount, collateral?,  autoApprove? })    // on-chain: mintSet(...)
```

Both take a **pool address**, not a symbol — the unified `exchange.mintSet(symbol, n)` is a wrapper over the raw tier. Both YES and NO are covered by **a single operator approval** on the outcome-token singleton, so approval is a one-time cost per pool, not per leg.

```
burnSet a complete set before expiry ->  exactly 1 collateral
hold it through resolution           ->  1 − f
hold it through a void               ->  1
```

So for any `f > 0`, **merging is strictly better than redeeming**, and equal at `f = 0`. Ballast therefore `burnSet`s `min(Y, N)` every pass rather than letting matched pairs ride into settlement. Today `f = 0` ([§3.5](#35-fees-are-currently-zero)) so this is free insurance; if the venue ever turns the fee on, the vault is already correct.

Only the residual imbalance — the leg that could not be matched — is ever redeemed through settlement.

---

## 9. The risk model

### 9.1 The risk is the imbalance

From `ec-core/src/orders.ts`, in the venue's own words:

> *"A complete set (one of each) is worth exactly one collateral whatever the outcome, so the risk a bot carries is the IMBALANCE, not the gross holding."*

Define `I = Y − N` in raw units. From [§2.4](#24-net-asset-value):

```
|ΔNAV|  ≤  |I|
```

A vault with `I = 0` has a NAV that cannot move with the market. All risk control reduces to bounding `|I|`.

### 9.2 The imbalance cap

`imbalanceCapRaw` is enforced in **two** places, deliberately:

- **In the quoter**, as a soft bound: as `|I|` grows the quotes skew — the side that would worsen the imbalance is widened, the side that would reduce it is tightened. This is standard inventory skewing and it makes the vault self-correcting under two-way flow.
- **In the contract**, as a hard bound: an operator action that would push `|I|` beyond the cap reverts. This is what protects depositors from a buggy or compromised quoter, and it is the reason the cap lives on-chain rather than in a config file.

### 9.3 Flattening

Two mechanisms reduce `|I|`:

1. **Merge** the matched portion each pass — removes `min(Y,N)` from both sides, does not change `I`, but frees collateral and shrinks the balance sheet.
2. **Skew or cross** to reduce `I` itself — quote the reducing side tighter; if `|I|` exceeds the cap, cross the spread to flatten rather than wait.

Crossing to flatten costs the spread. That is the correct trade: a bounded known cost to remove an unbounded unknown one.

### 9.4 Adverse selection is real

Being everyone's counterparty is how market makers lose money. If the only takers who arrive are better informed than the reference price, the vault bleeds — and on 15-minute BTC windows, informed flow is exactly what shows up.

**This must be stated in the demo, not hidden.** The kit ships `tools/edge-analytics`, which measures "captured spread vs adverse selection." Ballast runs it and reports the real number, including when it is negative over a short soak. A vault claiming clean yield after four days of testnet data is not credible; one that reports its adverse selection is.

---

## 10. User flows

### 10.1 The depositor

Deposits USDso, receives BALLAST shares, watches NAV and imbalance on the dashboard, withdraws at share price. Never touches a market directly. Their protection is the on-chain imbalance cap and the fact that the operator key cannot withdraw.

### 10.2 The trader on an empty book — *the demo*

1. Open the trade page. Pick BTC, 15-minute window, **Up**.
2. Before Ballast: the order rests. Nothing fills. It expires at the window.
3. Turn Ballast on. Place the same order.
4. **Filled in one block** — 0.1 s.

This is the thirty-second demo, and it is only possible *because* the venue is empty. Everything else in the build exists to make that clip honest.

### 10.3 The trader collecting winnings

Positions across every window in one view, unclaimed winnings surfaced, one-tap batch claim. The kit demonstrates EIP-7702 batching in `advanced/batch-7702` — thirty settled markets in one transaction.

---

## 11. The thirteen failure modes

Each is documented by the venue or measured by its team. Every one of them fails **silently** unless handled.

**11.1 The indexer lags.** Gate writes on `onchain.status`, never the indexed status.

**11.2 A reverted write does not throw.** The SDK skips simulation and resolves even when the transaction reverted; the receipt rides on `info`, not the returned order. **Wrap every state-changing call in `assertTxOk`.** A mint on a Locked market "succeeds" silently otherwise.

**11.3 Float prices land off the tick grid.** [§6.1](#61-never-hand-the-sdk-a-float-price-on-an-18-decimal-venue). Use `placeLimit`.

**11.4 IOC or resting is a decision.** An unfilled limit remainder rests with escrow locked, invisibly, unless you track open orders.

**11.5 Order expiry is mandatory.** Every order carries `expireTimestampNs`, capped at the market's own expiry. Set it just past the requote interval so a crashed quoter's orders age off the book by themselves.

**11.6 Lot sizing is yours to do.** `amountToPrecision` snaps binaries to a whole share. Use `quantize`; a 0 return means skip.

**11.7 Reconcile against the wallet.** Escrow leaves the wallet and returns to it. A taker is charged the *fill* price, not the price it offered.

**11.8 Scale expiry headroom to the window.** A 5-minute window tolerates far less requote latency than a 1-hour one.

**11.9 `loadMarkets()` hides settled markets.** [§8.3](#83-finding-settled-markets).

**11.10 Pools are recycled.** Resolve by `marketId`; never cache a pool address across windows. A finalized market's fee must be read from the settlement record, not from the pool — the pool may already be serving a different market.

**11.11 Venue ids move.** [§3.4](#34-the-live-venue-and-why-it-drifts). Read from a live row; use `explainEmptyScope()` to distinguish "no live binaries" from "your scope excludes them."

**11.12 There is no naked short.** You may only sell an outcome you hold. Selling requires minting a complete set first. This is the constraint that makes Ballast necessary and the reference maker inadequate.

**11.13 One key, one process.** Claiming and quoting sign from the same key; concurrent senders race the nonce. Serialise inside one loop.

---

## 12. Threat model

**12.1 Malicious or buggy operator.** The operator key can trade but cannot withdraw, and the contract rejects any action breaching `imbalanceCapRaw`. Worst case is spread bled through bad quoting, bounded by the cap per window.

**12.2 Informed flow.** [§9.4](#94-adverse-selection-is-real). Mitigated by spread width, size limits per window, and the imbalance cap. Not eliminated — it is the business Ballast is in.

**12.3 Oracle or resolution failure.** Resolution is DreamDEX's, not Ballast's. A void refunds both legs at 0.5, so a complete set is unharmed; only an outstanding imbalance is exposed, and it is capped.

**12.4 Decimal mismatch.** 6 dp on testnet, 18 on mainnet. Every amount flows through `toRawUnits(h, config.decimals)`. A hardcoded `1e18` on testnet would inflate every size by 10¹².

**12.5 Pool recycling mid-pass.** One snapshot per pass, reused. [§11.10](#11-the-thirteen-failure-modes).

**12.6 Reentrancy.** Deposit and withdraw follow checks-effects-interactions and take a reentrancy guard. Share price is computed before any external transfer.

**12.7 Rounding extraction.** All share maths rounds in favour of the pool. Repeated deposit/withdraw cycles cannot extract value — [Invariant 4](#13-invariants).

**12.8 SDK breakage mid-flight.** Pinned version, committed lockfile, vendored `ec-core`. [§5.1](#51-why-a-fork-of-ec-core-not-the-sdk).

---

## 13. Invariants

Each is a property a test must assert, not a hope.

1. **Set conservation.** `mint(n)` then `merge(n)` returns exactly `n` collateral, for every `n` on the lot grid, on both networks.
2. **Imbalance bound.** After any sequence of operator actions, `|Y − N| ≤ imbalanceCapRaw`.
3. **NAV bound.** `C + min(Y,N) ≤ NAV ≤ C + min(Y,N) + |Y − N|` at all times.
4. **Share price monotonic.** No sequence of `deposit` and `withdraw` alone decreases `sharePrice()`.
5. **Operator cannot withdraw.** No operator-reachable path moves collateral to an address other than the vault or the venue.
6. **Two-sided fill is flat.** A matched pair of fills at `(b, a)` leaves `ΔY = ΔN = 0` and `ΔC = a − b`.
7. **No naked sell.** The quoter never submits a sell exceeding `sellableSize()`.
8. **Trading-gate.** No write is submitted against a market whose snapshot status is not `Trading`.

---

## 14. Test plan

**Unit.** Share maths at both decimal bases including the first deposit and the empty-vault edge; `quantize` at the tick and lot boundaries; `toRawUnits` round-trips; payout maths for resolved, losing and voided legs at `f = 0` and `f > 0`.

**Invariant / fuzz.** Invariants 1–8 under randomised sequences of deposit, withdraw, fill, mint, merge and resolution, including voids.

**Fork / integration.** Against a live testnet market: mint at size, place both legs, verify escrow leaves and returns on cancel, let a window expire, claim, and confirm collateral returns.

**Soak.** Overnight across market rolls. Capture fills, realised spread, and the `edge-analytics` adverse-selection number — the figures that go in the demo, whatever they say.

**Day-one spikes** — before any contract code is written:

1. `mintSet` at real size on a live testnet market, wrapped in `assertTxOk`.
2. Re-run the [§4](#4-why-this-venue-needs-this-thing) activity query against **testnet**. If testnet turns out to be genuinely busy, the empty-book demo loses its force and the plan should pivot to the positions-and-claims layer, which works either way.

---

## 15. Open items

**UNVERIFIED — maker rewards on event contracts.** DreamDEX markets a "yield-bearing order book" where makers are rewarded for quoting near top-of-book, with yield derived from the native stablecoin. I found **no confirmation this applies to event contracts specifically**, and all venue fee fields currently read 0. **Do not build the pitch on maker rewards.** Build it on making the venue tradeable, which is verified.

**RESOLVED — the merge verb is `burnSet`.** Confirmed by unpacking `@somnia-chain/markets-sdk@0.29.0` directly: `Trader.burnSet(params: BurnSetParams)` — *"surrender equal YES + NO, get collateral back"* — backed by an on-chain `burnSet(uint256 amount)`. There is no symbol named `mergeSet`; searching for one returns nothing, which is why this was open. [§8.4](#84-merge-before-expiry-do-not-redeem-after) is therefore verified, not assumed.

**UNVERIFIED — typical Somnia Agents latency.** The docs show one example receipt at `elapsedMs: 9800` with a 15-minute default timeout. Whether ~10 s is typical or a best case is unknown. Not on Ballast's critical path; relevant only if on-chain pricing verification is added later.

**CORRECTED — an earlier activity measurement.** A first pass using `eth_getLogs` over what appeared to be 100 minutes reported "four distinct senders." That measurement was **wrong**: the public RPC prunes logs beyond ~5,000 blocks and returns empty arrays rather than errors, so ~90 minutes of that window were silently counted as inactivity. The figures in [§4](#4-why-this-venue-needs-this-thing) come from the indexer and supersede it. Recorded here rather than deleted.

**Sample cap.** [§4](#4-why-this-venue-needs-this-thing) reflects 5,000 markets — the query limit. True totals may be larger; the ratios are unlikely to improve.

---

## 16. Sources

| What | Where |
| --- | --- |
| Protocol reference | `docs.dreamdex.io/developers/event-contracts` |
| Bot kit + `ec-core` source | `github.com/somnia-chain/dreamdex-bot-kit` |
| Event-contract gotchas | `dreamdex-bot-kit/docs/event-contracts.md` |
| SDK package + release history | `npmjs.com/package/@somnia-chain/markets-sdk` |
| Live market and fee data | `https://prd.smk.somnia.host/v1/graphql` |
| Contract addresses | `dreamdex-bot-kit/packages/ec-core/src/addresses.ts`, verified 2026-07-24 upstream |
| Lifetime activity | Somnia Blockscout, `explorer.somnia.network/api/v2` |
| Somnia Agents | `docs.somnia.network/agents` |

---

*Compiled 2026-09-01. Every on-chain figure reproducible with the commands and queries given above.*
