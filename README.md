# Ballast

**Live:** https://ballast-jet.vercel.app

**A pooled counterparty for DreamDEX event contracts, so the book is never empty.**

> *A market with no ballast capsizes.*

Live on Somnia testnet · [`0xbB00fDBc…F1a5AE`](https://shannon-explorer.somnia.network/address/0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905)

---

## The problem, measured

DreamDEX runs binary Up/Down markets on BTC and ETH — 5-minute, 15-minute and
1-hour windows, settled in USDso, zero fees. The markets roll on schedule and
settle correctly. Almost nobody trades them.

Across **5,000 settled markets** on mainnet, read from the public indexer:

| | |
| --- | --- |
| Markets that never saw a single trade | **83.5%** |
| Total lifetime volume | **3,833.91 USDso** |
| Mean volume per market | **0.77 USDso** |
| Busiest market in the venue's history | **100 trades — totalling one cent** |

Reproduce it in thirty seconds:

```bash
curl -s -X POST https://prd.smk.somnia.host/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Market(where:{marketType:{_eq:\"BINARY\"}}, order_by:{tradeCount:desc}, limit:5){ asset intervalSec tradeCount cumulativeQuoteVolume } }"}'
```

And it is worse than thin — it is often **one-sided**. Fresh windows open with a
`SELL_YES` ladder and no bids at all. At the time of writing, **5 of 10 live
testnet markets had no resting orders on one side**: a taker there cannot be
filled at any price.

This is a chicken-and-egg problem whose halves are not symmetric. Takers will not
come to an empty book — you click *Up*, nothing fills, you leave. Makers will not
quote where there is no flow. But **a taker cannot create a market for themselves,
while one maker can be the counterparty to everyone.** Only the maker side can be
broken unilaterally.

## What Ballast does

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

It has no view on Bitcoin and predicts nothing. Its only job is to be on the
other side, and to keep the two legs it accumulates close to equal.

## Why it is safe to always take the other side

One unit of collateral mints one YES **and** one NO, and that pair is worth
exactly one unit at every possible resolution:

| Resolution | YES pays | NO pays | Set |
| --- | ---: | ---: | ---: |
| YES wins | 1 | 0 | **1** |
| NO wins | 0 | 1 | **1** |
| Voided | 0.5 | 0.5 | **1** |

So matched legs carry no price risk at all. **The vault's entire exposure is the
imbalance between them**, never the size of either — and that is bounded on-chain
by a cap the operator key cannot exceed.

Two consequences, both proven in [ARCHITECTURE.md](./ARCHITECTURE.md) §2 and
asserted in the test suite:

- **Selling YES at `p` is identically buying NO at `1 − p`.** This is why the
  vault needs no pre-funded inventory and never shorts.
- **A matched pair of fills at bid `b` and ask `a` leaves the vault exactly flat
  and richer by `a − b`.**

## Live, right now

```
ballast quoter
  vault      0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905
  nav        500.0000  ·  share 1.0000  ·  imbalance 0.0000/50.0000

  ETH-0-01SEP26-1825/tUSDC   was 0.858/0.881   now 0.864/0.874  (mid)
  BTC-0-01SEP26-1825/tUSDC   was 0.880/0.903   now 0.886/0.896  (mid)
  18:24:06  2/2 quoted  ·  spread 4.60c -> 2.00c (-57%)
```

## Run it

```bash
# contracts
forge test                      # 42 tests, run at both 6dp and 18dp

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

`shadow` and `doctor` are read-only and safe to point at mainnet.

## Repository

| Path | What |
| --- | --- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The full spec: proofs, verified addresses, the arithmetic traps, the risk model, the thirteen documented ways this fails silently |
| [`FEEDBACK.md`](./FEEDBACK.md) | Nine SDK/docs issues found while building, with reproductions |
| [`DEPLOYMENTS.md`](./DEPLOYMENTS.md) | Addresses, and the Somnia gas note that cost two failed deploys |
| `src/` | `BallastVault.sol` and the DreamDEX interfaces |
| `test/` | 42 tests, every one mapped to a numbered invariant |
| `bot/` | The quoter, `doctor`, `shadow`, `setup`. Vendors `ec-core`. |
| `web/` | The dashboard |

## What this is not

- **Not a prediction engine.** No signal, no forecast, no alpha claim. The
  reference it quotes around is a spread anchor, not a view.
- **Not a yield product.** It may capture spread; on a venue this quiet it may
  capture nothing, and being everyone's counterparty is how market makers lose
  money. Any APY claim before real flow exists would be dishonest.
- **Not a market creator.** DreamDEX creates and resolves its own markets; there
  is no permissionless creation path and Ballast does not attempt one.

## Licence

MIT.
