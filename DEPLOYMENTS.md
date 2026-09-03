# Deployments

## Somnia testnet — chainId 50312

| | |
| --- | --- |
| `BallastVault` | `0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905` |
| Collateral (tUSDC, 6dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| Outcome token (ERC-6909 singleton) | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| Operator | `0x1258F0645a998Bc0e68AfBEC326e5654db4E1D89` |
| Imbalance cap | `50000000` (50 tUSDC) |
| DreamDEX venue | `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` |

Verified after deploy:

```sh
cast call 0xEfEb51b07c70e891c95aFdB05aeD2139a40B3905 'one()(uint256)' \
  --rpc-url https://api.infra.testnet.somnia.network   # -> 1000000  (6dp venue)
```

## Gas on Somnia

Deploying this contract costs **41,024,732 gas** — about ten times what the same
bytecode costs on Ethereum, and roughly fourteen times `forge`'s own estimate of
~2.8M. Three deploys failed out-of-gas before this was pinned down. The block
limit is 15,000,000,000, so there is no real constraint; the difficulty is
entirely in getting the gas figure past `forge`.

**The flag you need is `-g`, not `--gas-limit`.** On `forge script`,
`--gas-limit` is an alias for `--block-gas-limit`: it changes the simulation
environment and is silently ignored for the broadcast transaction. Passing
`--gas-limit 50000000` sends the estimate anyway and burns it. Use the
gas-estimate multiplier instead, as a percentage:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://api.infra.testnet.somnia.network \
  --private-key $PRIVATE_KEY \
  --broadcast -g 2500 --legacy
```

`-g 2500` multiplies the estimate by 25, giving ~70M of headroom against a real
cost of 41M. Unused gas is refunded, so over-provisioning is free.

Gas scales with contract size: at 9,928 bytes this vault cost ~34.3M; at 11,940
bytes it costs 41.0M. Re-measure after any change that grows the bytecode.

Ordinary calls are cheap by comparison: `setOperator` 241k, `approve` 260k,
`deposit` 719k.

The outcome token is one singleton shared by every market on the network —
checked against four live markets, all reporting the same address. Pools are
per-series and rebind their outcome ids each window, so the vault reads ids
from the pool rather than storing them.

## Somnia mainnet — chainId 5031

Not deployed. `script/Deploy.s.sol` expects `OUTCOME_TOKEN` in the environment
for mainnet: read it off a live market rather than assuming it matches testnet.

## Front end

https://ballast-jet.vercel.app — Vercel, production. Built from `web/`.
Redeploy with `vercel deploy --prod --yes --scope madhavgupta28s-projects` from the repo root.
