/**
 * Client-side chain wiring for the deposit/withdraw panel.
 *
 * Read paths (the market table, the vault stats) stay on the server and never
 * touch this file. This is only for the wallet: connect, approve, deposit,
 * withdraw. Injected-only by design — a WalletConnect project id is one more
 * thing that can be unset at demo time, and every Somnia wallet is injected.
 */
import { defineChain } from "viem";
import { createConfig, http, injected } from "wagmi";
import { parseAbi } from "viem";

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  blockExplorers: {
    default: { name: "Shannon", url: "https://shannon-explorer.somnia.network" },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [somniaTestnet],
  connectors: [injected()],
  transports: { [somniaTestnet.id]: http("https://api.infra.testnet.somnia.network") },
  ssr: true,
});

/** Only what the panel calls. The vault is itself the share ERC-20. */
export const vaultWriteAbi = parseAbi([
  "function deposit(uint256 amount) returns (uint256)",
  "function withdraw(uint256 shares) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nav() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function paused() view returns (bool)",
  "function collateral() view returns (address)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
