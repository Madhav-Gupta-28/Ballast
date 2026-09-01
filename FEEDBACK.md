# SDK and documentation feedback

Written while building [Ballast](./README.md) against DreamDEX event contracts on
Somnia testnet, 1–2 September 2026, using `@somnia-chain/markets-sdk@0.28.1` and
`dreamdex-bot-kit` at `main`.

Everything below cost real time. Each item says what happened, what the symptom
looked like, and — where I have one — a suggested fix. Ordered by how much time
it cost, not by severity.

---

## 1. `placeOrder` does not work on a binary pool, and the error is undocumented

**What happened.** The vault called `placeOrder(bool isBid, uint64 userData, uint256 price, …)`
— the signature exported in `binaryPoolWriteAbi` — and every order reverted with
`0x341c6622`. No public 4-byte database has it. I found it by extracting all 494
error names from the SDK's ABIs and computing selectors until one matched:
**`UseBinaryPlacement()`**.

The correct entry point is `placeBinaryOrder(uint8 kind, …)`, where `kind` is
`0 BUY_YES · 1 SELL_YES · 2 BUY_NO · 3 SELL_NO`.

**Why it took so long.** `binaryPoolWriteAbi` exports *both* `placeOrder` and
`placeBinaryOrder`, with no marker saying the first one always reverts on this
pool type. `docs/event-contracts.md` lists eight sharp edges and this is not among
them, even though it is the one that stops every write dead.

**Suggested fix.** One line in `docs/event-contracts.md`: *"Binary markets use
`placeBinaryOrder(kind, …)`. The generic `placeOrder(isBid, …)` reverts with
`UseBinaryPlacement()`."* Better still, ship the custom errors in a
`binaryErrorsAbi` export so `viem` and `cast` can decode them without a selector
hunt.

---

## 2. Contract deployment costs ~10× the estimate, and the failure mode is silent

**What happened.** Deploying a 9.9KB contract used **34,277,751 gas**. `forge`
estimated 3,097,840. Two deploys failed before this was clear — and a failed
`CREATE` consumes the entire gas limit, so the symptom is not "reverted", it is
"transaction succeeded according to the script, but `eth_getCode` returns empty".

```
forge script … --broadcast     -> "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL"
cast codesize <address>        -> 0
```

The block gas limit is 15,000,000,000, so there is no real constraint — you just
have to know to pass `--gas-limit 50000000`.

**Suggested fix.** A line in the network docs: *"Gas metering differs from
Ethereum; contract deployment typically costs 5–10× what `forge` estimates. Pass
an explicit `--gas-limit`."* This is the single most confusing thing about
deploying on Somnia for anyone arriving from mainnet Ethereum.

---

## 3. `tickSize` and `lotSize` are `null` on binary market rows

**What happened.** The indexer's `Market` type has `tickSize`, `lotSize` and
`minQuantity`, and on every BINARY row all three are `null`. So the venue's price
and size granularity is not discoverable through the API at all.

`ec-core` works around this by hardcoding `MM_TICK` and `MM_LOT` per network,
with a comment saying they are "NOT discoverable through the SDK". That is a
correct workaround and it should not have to exist.

**Suggested fix.** Populate those three fields for binary markets. Any integrator
who is not reading the bot kit's source will guess, and guessing produces
`InvalidPrice` at a rate of about 12 in 15 (see §4).

---

## 4. Confirming the float/tick-grid trap — and a second, opposite one

Your docs already warn that `(0.05).toFixed(18)` lands three wei off the grid and
gets rejected. Confirmed, and it is as bad as described.

**The mirror image is not documented and cost me a full debugging cycle.** Prices
arriving *from* the order book are JS numbers, and a float is routinely a hair
*below* the decimal it prints as: `(0.6).toFixed(18)` is
`"0.599999999999999978"`. Expand that to raw units and floor it, and 0.6 becomes
0.599 — every quote one tick low, silently, forever. It only shows up on the 18dp
venue; at 6dp it is invisible.

**Suggested fix.** Extend the existing gotcha to say: *convert to ticks by
rounding, not truncating, in both directions.*

---

## 5. Pools are reassigned across assets, not just across windows

**What happened.** The docs say a pool rebinds its `(nonce → ids)` pair each
window. What they do not say is that the pool can also change **asset**:

```
15:55  pool 0x699dce5b…  ->  ETH-0-01SEP26-1755
17:00  pool 0x699dce5b…  ->  BTC-0-01SEP26-1900
```

A live pool was on `marketNonce` 98 when I checked it.

**Why it matters.** Any integrator caching `(pool → yesId, noId)` — which is the
obvious thing to do — ends up not merely reading stale ids but *counting a
different asset's market as their own position*. In my case that would have
disabled a risk cap precisely when a position was real.

**Suggested fix.** Say it explicitly in `docs/event-contracts.md`: *"A pool
address identifies a venue slot, not a market. It is recycled across windows and
across assets. Resolve everything by `marketId`, and read outcome ids from
`getBinaryPoolParams()` at the point of use."*

---

## 6. `eth_getLogs` returns an empty array beyond ~5,000 blocks instead of an error

**What happened.** The public RPC serves logs for roughly the last 5,000 blocks —
about eight minutes at 0.1s blocks — and beyond that returns `{"result": []}`
rather than an error. Any historical scan therefore reports "no activity" with
complete confidence.

I published an activity measurement based on this before catching it. It was
wrong by an order of magnitude.

**Suggested fix.** Return an error (as the 1,000-block range cap already does —
`"block range exceeds 1000"` is a *good* error, it is impossible to misread).
Silence that looks like data is the worst possible failure mode for an RPC.

---

## 7. Two venues are live on testnet, and the manifest points at the wrong one

`activeMarkets()` throws when live markets span multiple venues, which is correct
for a bot and unhelpful for a first run — the error tells you to set `VENUE_ID`
but not what to set it to. On testnet right now there are two:

```
0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c   10 markets  (DreamDEX)
0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f    4 markets
```

And the indexer's `MarketVenue` rows describe a *third* venue
(`0xcc69885f…`, operatorId 1) that has no live markets on it. The kit's source
already warns not to trust the manifest; the docs do not.

**Suggested fix.** Have the thrown error list the candidate venue ids with market
counts. That is a two-line change and it turns a dead end into a copy-paste.

---

## 8. Redemption assumes the holder is an EOA

`maybeClaim` / `claimSettled` in `ec-core` sign from the configured key and redeem
**that key's** holdings. If the outcome tokens are held by a contract — which they
must be for any vault, and which the venue's own "yield-bearing order book"
framing implies — there is no path in the kit that reaches them.

The underlying primitive is fine: `BinarySettlement.redeem(outcomeId, amount, to)`
is exactly right, and a contract can call it directly. It just is not surfaced in
the kit, and the kit is where people will look.

**Suggested fix.** A short section in `docs/event-contracts.md` on redeeming from
a contract, pointing at `binarySettlementAbi` and noting that
`finalizeAndRedeem(pool, …)` handles the not-yet-finalized case in one call.

---

## 9. Newly created markets open with one side of the book missing

Not a bug, but worth documenting because it shapes what integrators build. Fresh
windows consistently open with a `SELL_YES` ladder and **no bids at all**:

```
BTC 300s  exp 1788288000   SELL_YES 0.020@200  0.028@330  0.035@460
                           (no BUY_YES, no SELL_NO — nothing to sell into)
```

At the time of writing, **5 of 10 live markets had no resting orders on one
side**. A taker there cannot be filled at any price. Any consumer-facing app
built on event contracts needs to handle "your order will not fill" as the normal
case, not the exception.

---

## Things that are good, and that I would not change

- **`assertTxOk`.** The SDK resolving on a reverted receipt is a genuine trap, and
  the kit calls it out and hands you the guard. That comment saved me hours.
- **`docs/event-contracts.md`'s "sharp edges" section** is one of the better
  pieces of protocol documentation I have used. The claim-not-received warning in
  particular is exactly the kind of thing that is normally left to be discovered.
- **The indexer is excellent and under-advertised.** It serves the complete order
  book — every open order with price, remaining size, side and owner — over plain
  GraphQL with no auth. I dropped the SDK from my web app entirely because of it.
  This deserves to be in the developer docs; right now you have to go and find it.
- **`ec-core` as a shipped artifact** is the right idea. Publishing the
  workarounds alongside the SDK, with the reasons written down, is much more
  useful than a clean API that quietly requires the same knowledge.

---

*Filed as part of the Somnia × DreamDEX Event Contracts Hackathon. Happy to
expand on any of these — every claim above is reproducible with the commands in
[ARCHITECTURE.md §3](./ARCHITECTURE.md).*
