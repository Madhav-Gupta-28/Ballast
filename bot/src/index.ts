/**
 * ballast quote — run the counterparty.
 *
 * Reads DreamDEX through the vendored ec-core, writes through the deployed
 * BallastVault. In dry-run it does everything except sign, which is how you
 * should always run it first.
 */
import type { Address, Hex } from "viem";
import { createExchange, shutdown } from "./ec/exchange.js";
import { makeChain } from "./ec/config.js";
import { runPass, summarise, type LoopConfig } from "./loop.js";
import { Vault, human } from "./vault.js";
import type { TickGrid } from "./pricing.js";

const num = (k: string, fallback: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Rebuilt on demand: the exchange holds a WebSocket, and a socket that dies
  // stays dead. See the reconnect logic in the loop below.
  let ctx = createExchange();
  const { config } = ctx;

  const dryRun = process.env.DRY_RUN !== "false" && process.env.DRY_RUN !== "0";
  const vaultAddress = (process.env.VAULT_ADDRESS ?? "").trim() as Address;

  if (!vaultAddress) {
    console.error(
      "\n  VAULT_ADDRESS is not set. Deploy BallastVault first, or run `pnpm doctor`\n" +
        "  to inspect the venue without one.\n",
    );
    process.exit(1);
  }

  const grid: TickGrid = { tick: config.tick, decimals: config.decimals };
  const cfg: LoopConfig = {
    halfSpread: num("MM_HALF_SPREAD", 0.005),
    quoteSize: num("MM_QUOTE_SIZE", 1),
    refreshMs: num("MM_REFRESH_MS", 15_000),
    maxMarkets: num("MM_MAX_MARKETS", 10),
  };

  const vault = new Vault({
    address: vaultAddress,
    rpcUrl: config.rpcUrl,
    chain: makeChain(config),
    privateKey: config.privateKey as Hex | undefined,
    dryRun,
  });

  console.log(`\nballast quoter${dryRun ? "  [DRY RUN — nothing will be signed]" : ""}`);
  console.log(`  network    ${config.network} (${config.chainId})`);
  console.log(`  vault      ${vaultAddress}`);
  console.log(`  operator   ${vault.operatorAddress ?? "none — read-only"}`);
  console.log(`  spread     ±${cfg.halfSpread} · size ${cfg.quoteSize} · every ${cfg.refreshMs}ms`);

  const state = await vault.state().catch((e) => {
    console.error(`\n  could not read the vault at ${vaultAddress}: ${(e as Error).message}\n`);
    process.exit(1);
  });

  console.log(
    `  nav        ${human(state.nav, config.decimals)}` +
      `  ·  share ${human(state.sharePrice, 18)}` +
      `  ·  imbalance ${human(state.imbalance, config.decimals)}/${human(state.imbalanceCap, config.decimals)}`,
  );
  if (state.paused) console.log(`  ! vault is PAUSED — operator actions will revert`);
  console.log();

  let stop = false;
  const bye = async () => {
    if (stop) return;
    stop = true;
    console.log(`\n  stopping — resting orders will age off at their expiry\n`);
    await shutdown(ctx).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);

  // A dead WebSocket is the failure that matters here. The context is built
  // once, so when the socket drops every later pass throws and the process
  // sits there logging failures while looking perfectly healthy — which is
  // exactly what happened: twenty minutes of "WebSocket request failed" with
  // nothing on the book. Rebuild the connection rather than narrate its death.
  const RECONNECT_AFTER = 3;   // consecutive failed passes before reconnecting
  const GIVE_UP_AFTER = 12;    // ... before exiting so a supervisor restarts us
  let consecutiveFailures = 0;

  for (;;) {
    if (stop) break;
    const started = Date.now();
    const at = new Date().toISOString().slice(11, 19);

    try {
      const stats = await runPass(ctx, vault, cfg, grid);
      if (consecutiveFailures > 0) {
        console.log(`  ${at}  recovered after ${consecutiveFailures} failed pass(es)`);
      }
      consecutiveFailures = 0;
      console.log(`  ${at}  ${summarise(stats, grid)}`);
      for (const e of stats.errors) console.log(`    ! ${e}`);
    } catch (e) {
      consecutiveFailures += 1;
      console.log(`  ${at}  pass failed (${consecutiveFailures}): ${(e as Error).message}`);

      if (consecutiveFailures >= GIVE_UP_AFTER) {
        console.error(
          `\n  ${consecutiveFailures} consecutive failures including reconnects. ` +
            `Exiting non-zero so a supervisor restarts a clean process.\n`,
        );
        await shutdown(ctx).catch(() => {});
        process.exit(1);
      }

      if (consecutiveFailures % RECONNECT_AFTER === 0) {
        console.log(`  ${at}  reconnecting the exchange…`);
        await shutdown(ctx).catch(() => {});
        try {
          ctx = createExchange();
          console.log(`  ${at}  reconnected`);
        } catch (re) {
          console.log(`  ${at}  reconnect failed: ${(re as Error).message}`);
        }
      }
    }

    const elapsed = Date.now() - started;
    await sleep(Math.max(1_000, cfg.refreshMs - elapsed));
  }
}

main().catch((e) => {
  console.error(`\n  ${e?.message ?? e}\n`);
  process.exit(1);
});
