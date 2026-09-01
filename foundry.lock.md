# Pinned dependencies

Installed with `forge install <repo> --no-git`. `lib/` is gitignored; restore with:

```sh
forge install foundry-rs/forge-std --no-git
forge install transmissions11/solmate --no-git
```

The SDK side is pinned exactly in `package.json` — see ARCHITECTURE.md §5.1 for why
that matters (`@somnia-chain/markets-sdk` shipped ten releases in 28 days).
