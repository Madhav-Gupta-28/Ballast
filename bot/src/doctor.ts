/**
 * ballast doctor — run this before anything else, and again whenever the bot
 * goes quiet.
 *
 * Silence is the failure mode that costs the most time here. Venue ids move,
 * the indexer lags the chain, and a scope that matches nothing looks exactly
 * like a market that has no orders. This tells the two apart and prints the
 * VENUE_ID you should actually be using.
 */
import { createExchange, shutdown } from "./ec/exchange.js";
import { activeMarkets, marketOnchain, outcomeSymbols, snapshot, isTradable, explainEmptyScope, venueOf, MARKET_STATUS } from "./ec/markets.js";
import type { UnifiedMarket } from "@somnia-chain/markets-sdk";

const STATUS_NAME = Object.fromEntries(Object.entries(MARKET_STATUS).map(([k, v]) => [v, k]));

const fmt = (n: number | undefined, dp = 4) => (n === undefined ? "—" : n.toFixed(dp));

async function main() {
  const ctx = createExchange();
  const { config } = ctx;

  console.log(`\nballast doctor`);
  console.log(`  network    ${config.network}  (chainId ${config.chainId})`);
  console.log(`  rpc        ${config.rpcUrl}`);
  console.log(`  indexer    ${config.indexerUrl}`);
  console.log(`  collateral ${config.addresses.collateral}  (${config.decimals} dp)`);
  console.log(`  tick / lot ${config.tick} / ${config.lot}`);
  console.log(`  venue      ${config.venueId ?? "(unset — will infer)"}`);
  console.log(`  signer     ${ctx.canTrade ? ctx.exchange.walletAddress : "none (read-only)"}`);

  let markets: UnifiedMarket[] = [];
  try {
    markets = await activeMarkets(ctx, { max: 50 });
  } catch (e) {
    // `activeMarkets` refuses to guess when live markets span several venues,
    // which is the right call for a bot and the wrong one for a diagnostic.
    // Here we want the list, so drop to the raw registry and group it.
    const all = Object.values(await ctx.exchange.loadMarkets(true)) as UnifiedMarket[];
    const live = all.filter((m) => m.type === "binary" && m.active);
    const byVenue = new Map<string, UnifiedMarket[]>();
    for (const m of live) {
      const v = String(venueOf(m) ?? "unknown").toLowerCase();
      byVenue.set(v, [...(byVenue.get(v) ?? []), m]);
    }
    console.log(`\n  ! live markets span ${byVenue.size} venues — pick one and set VENUE_ID:\n`);
    for (const [v, ms] of [...byVenue].sort((a, b) => b[1].length - a[1].length)) {
      const assets = [...new Set(ms.map((m) => (m.info as { asset?: string }).asset ?? "?"))].join(", ");
      console.log(`    VENUE_ID=${v}`);
      console.log(`      ${ms.length} market(s), assets: ${assets}\n`);
    }
    await shutdown(ctx);
    process.exit(1);
  }

  if (markets.length === 0) {
    console.log(`\n  ✗ no live markets in scope`);
    console.log(`    ${await explainEmptyScope(ctx)}`);
    await shutdown(ctx);
    process.exit(1);
  }

  // The venue every live market actually sits on. This is the value to put in
  // .env — not whatever the deployment manifest claims is active.
  const venues = [...new Set(markets.map((m) => String(venueOf(m) ?? "").toLowerCase()))];
  console.log(`\n  ${markets.length} live market(s) on ${venues.length} venue(s)`);
  for (const v of venues) console.log(`    VENUE_ID=${v}`);

  console.log(
    `\n  ${"market".padEnd(26)}${"status".padEnd(9)}${"bid".padEnd(8)}${"ask".padEnd(8)}${"spread".padEnd(9)}book`,
  );
  console.log(`  ${"-".repeat(74)}`);

  let empty = 0;
  let oneSided = 0;
  const spreads: number[] = [];

  for (const m of markets.slice(0, 12)) {
    const oc = await marketOnchain(ctx, m);
    const { yes } = outcomeSymbols(m);
    const ob = await ctx.exchange.fetchOrderBook(yes, 10).catch(() => ({ bids: [], asks: [] }));
    const bids = ob.bids as [number, number][];
    const asks = ob.asks as [number, number][];
    const depth = (side: [number, number][]) => side.reduce((a, l) => a + l[1], 0);

    const bestBid = bids[0]?.[0];
    const bestAsk = asks[0]?.[0];
    const status = oc ? (STATUS_NAME[oc.status] ?? String(oc.status)) : "?";

    let note: string;
    if (bids.length === 0 && asks.length === 0) {
      empty++;
      note = "EMPTY — no quotes at all";
    } else if (bids.length === 0 || asks.length === 0) {
      oneSided++;
      note = asks.length === 0 ? "ONE-SIDED — cannot buy YES at any price" : "ONE-SIDED — cannot sell YES at any price";
    } else {
      const sp = bestAsk! - bestBid!;
      spreads.push(sp);
      note = `${bids.length}x${asks.length} levels, ${depth(bids).toFixed(0)}/${depth(asks).toFixed(0)} shares`;
    }

    const spreadStr = bestBid !== undefined && bestAsk !== undefined ? fmt(bestAsk - bestBid) : "—";
    console.log(
      `  ${m.symbol.padEnd(26)}${status.padEnd(9)}${fmt(bestBid, 3).padEnd(8)}${fmt(bestAsk, 3).padEnd(8)}` +
        `${spreadStr.padEnd(9)}${note}`,
    );
  }

  const shown = Math.min(markets.length, 12);
  const gap = empty + oneSided;
  const avgSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;

  console.log(`\n  ${gap}/${shown} markets are untradable on at least one side.`);
  if (spreads.length) {
    console.log(`  Where both sides exist, the mean spread is ${(avgSpread * 100).toFixed(2)} cents.`);
  }
  if (gap > 0) {
    console.log(`  A taker on those ${gap} cannot get filled at any price. That is the gap Ballast closes.`);
  }

  await shutdown(ctx);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  ✗ ${e?.message ?? e}\n`);
  process.exit(1);
});
