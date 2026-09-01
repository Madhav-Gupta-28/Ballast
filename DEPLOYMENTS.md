# Deployments

## Somnia testnet — chainId 50312

| | |
| --- | --- |
| `BallastVault` | `0x67c3E6d59BbE0AfdAf1b0F0876BB77250283303a` |
| Collateral (tUSDC, 6dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| Outcome token (ERC-6909 singleton) | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| Operator | `0x1258F0645a998Bc0e68AfBEC326e5654db4E1D89` |
| Imbalance cap | `50000000` (50 tUSDC) |
| DreamDEX venue | `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` |

Verified after deploy:

```sh
cast call 0x67c3E6d59BbE0AfdAf1b0F0876BB77250283303a 'sharePrice()(uint256)' \
  --rpc-url https://api.infra.testnet.somnia.network   # -> 1000000000000000000
```

The outcome token is one singleton shared by every market on the network —
checked against four live markets, all reporting the same address. Pools are
per-series and rebind their outcome ids each window, so the vault reads ids
from the pool rather than storing them.

## Somnia mainnet — chainId 5031

Not deployed. `script/Deploy.s.sol` expects `OUTCOME_TOKEN` in the environment
for mainnet: read it off a live market rather than assuming it matches testnet.
