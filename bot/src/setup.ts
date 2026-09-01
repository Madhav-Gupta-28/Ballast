/**
 * ballast setup — fund the vault and allowlist the pools it may trade.
 *
 * Both are owner actions, deliberately separate from anything the quoter can
 * do. Run it again whenever a new market series appears: pools are per-series
 * and persist across windows, so the list grows slowly and then stops.
 *
 *   pnpm setup            # show what would happen
 *   pnpm setup --deposit 1000 --allow
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createExchange, shutdown } from "./ec/exchange.js";
import { makeChain } from "./ec/config.js";
import { activeMarkets, marketOnchain, isTradable } from "./ec/markets.js";
import { vaultAbi, human } from "./vault.js";

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const has = (flag: string) => process.argv.includes(flag);

/**
 * Decimal string -> raw units, exactly.
 *
 * Never route this through Number. At 18 decimals `1000.5 * 1e18` is 1.0005e21,
 * far past the 2^53 where a double stops representing integers exactly, so
 * `Math.round` there returns a number that is merely close to what the operator
 * typed. Parse the digits instead.
 */
export function parseUnitsExact(value: string, decimals: number): bigint {
  const t = value.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`not a positive decimal amount: "${value}"`);
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimal places`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

async function main() {
  const ctx = createExchange({ withSigner: true });
  const { config } = ctx;
  const vaultAddress = (process.env.VAULT_ADDRESS ?? "").trim() as Address;
  if (!vaultAddress) throw new Error("VAULT_ADDRESS is not set");

  const chain = makeChain(config);
  const account = privateKeyToAccount(config.privateKey as Hex);
  const pub = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const collateral = config.addresses.collateral as Address;

  const depositHuman = arg("--deposit");
  const doAllow = has("--allow");
  const dry = !depositHuman && !doAllow;

  console.log(`\nballast setup${dry ? "  [preview — pass --deposit and/or --allow to act]" : ""}`);
  console.log(`  vault    ${vaultAddress}`);
  console.log(`  owner    ${account.address}`);

  const owner = (await pub.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "operator",
  })) as Address;
  console.log(`  operator ${owner}`);

  /* ── deposit ── */

  const bal = (await pub.readContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  console.log(`  wallet   ${human(bal, config.decimals)} collateral`);

  if (depositHuman) {
    const amount = parseUnitsExact(depositHuman, config.decimals);
    if (amount > bal) throw new Error(`deposit ${depositHuman} exceeds wallet balance`);

    const allowance = (await pub.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, vaultAddress],
    })) as bigint;

    if (allowance < amount) {
      const h = await wallet.writeContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultAddress, amount],
        chain,
      });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`  approve  ${h}`);
    }

    const h = await wallet.writeContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "deposit",
      args: [amount],
      chain,
    } as never);
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  deposit  ${h}  (${depositHuman})`);
  }

  /* ── allowlist ── */

  const markets = await activeMarkets(ctx, { max: 40 });
  const pools = new Map<string, string>();
  for (const m of markets) {
    const oc = await marketOnchain(ctx, m);
    if (oc && isTradable(oc)) pools.set((oc.pool as string).toLowerCase(), m.symbol);
  }

  console.log(`\n  ${pools.size} distinct pool(s) behind ${markets.length} live market(s)`);

  let added = 0;
  for (const [pool, symbol] of pools) {
    const allowed = (await pub.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "poolAllowed",
      args: [pool as Address],
    })) as boolean;

    if (allowed) {
      console.log(`    ok      ${pool}  ${symbol}`);
      continue;
    }
    if (!doAllow) {
      console.log(`    would   ${pool}  ${symbol}`);
      continue;
    }

    const h = await wallet.writeContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "allowPool",
      args: [pool as Address],
      chain,
    } as never);
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`    added   ${pool}  ${symbol}`);
    added++;
  }

  const nav = (await pub.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "nav" })) as bigint;
  console.log(`\n  nav ${human(nav, config.decimals)}${added ? `  ·  ${added} pool(s) allowlisted` : ""}\n`);

  await shutdown(ctx);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  ${e?.message ?? e}\n`);
  process.exit(1);
});
