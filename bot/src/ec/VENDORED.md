# Vendored: `@dreamdex-bot-kit/ec-core`

Copied verbatim from [`somnia-chain/dreamdex-bot-kit`](https://github.com/somnia-chain/dreamdex-bot-kit)
at `packages/ec-core/src`, on 2026-09-01. MIT, © DreamDEX S.A. — licence in
`LICENSE-upstream`, per-file headers left untouched.

## Why vendored rather than imported

`@somnia-chain/markets-sdk` published 0.20.0 on 4 August and 0.29.0 on 1
September — ten releases in 28 days, twice with two minor bumps on the same
day. The docs warn that anything below 0.28.0 mis-loads markets and produces
off-grid prices the pool rejects.

`ec-core` already wraps every sharp edge Ballast would otherwise hit:

| Helper | What it protects against |
| --- | --- |
| `placeLimit` | float prices landing off the tick grid (`toFixed(18)` puts 0.05 three wei out) |
| `quantize` | `amountToPrecision` snapping binary sizes to a whole share |
| `assertTxOk` | reverted writes resolving silently — the SDK never checks receipt status |
| `marketOnchain` | pool recycling; resolves by bytes32 marketId, not a pool address |
| `settledMarkets` | `loadMarkets()` skipping finalized binaries since SDK 0.20 |
| `explainEmptyScope` | venue ids moving, leaving a bot silently finding nothing |

Vendoring gives one seam to repair when the SDK moves, instead of five.

## Updating

Re-copy the directory and re-read `docs/event-contracts.md` upstream for new
sharp edges. Do not update during a build week.
