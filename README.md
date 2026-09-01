# Ballast

**A pooled counterparty for DreamDEX event contracts, so the book is never empty.**

> *A market with no ballast capsizes.*

---

## The problem

DreamDEX runs binary Up/Down markets on BTC and ETH — 5-minute, 15-minute and 1-hour windows, settled in USDso, zero fees. The markets roll on schedule and settle correctly. Almost nobody trades them.

Measured against the public indexer on 2026-09-01, across 5,000 settled markets:

| | |
| --- | --- |
| Markets that never saw a single trade | **83.5%** |
| Total lifetime volume | **3,833.91 USDso** |
| Mean volume per market | **0.77 USDso** |
| Busiest market in the venue's history | **100 trades — totalling one cent** |

Reproduce it yourself:

```bash
curl -s -X POST https://prd.smk.somnia.host/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Market(where:{marketType:{_eq:\"BINARY\"}}, order_by:{tradeCount:desc}, limit:5){ asset intervalSec tradeCount cumulativeQuoteVolume } }"}'
```

This is a chicken-and-egg problem, and its two halves are not symmetric. Takers will not come to an empty book — you click *Up*, nothing fills, you leave. Makers will not quote where there is no flow. But **a taker cannot create a market for themselves, while one maker can be the counterparty to everyone.** Only the maker side can be broken unilaterally.

## What Ballast does

A pot of collateral that is always willing to take the other side.

```
DEPOSIT   n USDso           →  n BALLAST shares
QUOTE     two-sided book on every live BTC/ETH window
FILL      taker buys YES    →  mint a set, deliver YES, keep NO
          taker buys NO     →  mint a set, deliver NO,  keep YES
FLATTEN   matched YES+NO    →  burnSet back to collateral, riskless
WITHDRAW  m shares          →  m × NAV / totalShares
```

It has no view on Bitcoin and predicts nothing. Its only job is to be on the other side and keep the two legs it accumulates close to equal.

## Why it is safe to always take the other side

On DreamDEX one unit of collateral mints one YES **and** one NO, and that pair is worth exactly one unit at every possible resolution:

| Resolution | YES pays | NO pays | Set |
| --- | ---: | ---: | ---: |
| YES wins | 1 | 0 | **1** |
| NO wins | 0 | 1 | **1** |
| Voided | 0.5 | 0.5 | **1** |

So holding matched YES and NO carries no price risk at all. **The vault's entire exposure is the imbalance between the two legs, never the size of either.** That is bounded on-chain by a hard cap the operator key cannot exceed.

Two further consequences, both proven in [ARCHITECTURE.md](./ARCHITECTURE.md):

- **Selling YES at `p` is identically buying NO at `1 − p`.** This is why the vault needs no pre-funded inventory and never shorts.
- **A matched pair of fills at bid `b` and ask `a` leaves the vault exactly flat and richer by `a − b`.**

## Status

Early. Building for the Somnia × DreamDEX Event Contracts hackathon.

The full specification — proofs, verified contract addresses, the integer-arithmetic traps, the market lifecycle, the risk model and the thirteen documented ways this fails silently — is in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Licence

MIT.
