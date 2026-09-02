# Deployments

## Somnia testnet — chainId 50312

| | |
| --- | --- |
| `BallastVault` | `0xbB00fDBc4a0700f3cD41e38A63bc7D1f66F1a5AE` |
| Collateral (tUSDC, 6dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| Outcome token (ERC-6909 singleton) | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| Operator | `0x1258F0645a998Bc0e68AfBEC326e5654db4E1D89` |
| Imbalance cap | `50000000` (50 tUSDC) |
| DreamDEX venue | `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` |

Verified after deploy:

```sh
cast call 0xbB00fDBc4a0700f3cD41e38A63bc7D1f66F1a5AE 'one()(uint256)' \
  --rpc-url https://api.infra.testnet.somnia.network   # -> 1000000  (6dp venue)
```

## Gas on Somnia

Deploying this contract costs **~34.3M gas** — roughly ten times what the same
bytecode costs on Ethereum, and well above `forge`'s own estimate of ~3.1M. Two
deploys failed out-of-gas before this was clear. The block limit is 15 billion,
so there is plenty of room; just pass `--gas-limit 50000000` explicitly.

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
