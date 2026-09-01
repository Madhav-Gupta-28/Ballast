/**
 * The quoter loop.
 *
 * One pass per refresh interval. The order of steps is not cosmetic — each one
 * depends on the previous holding. In particular the on-chain snapshot is taken
 * ONCE per market per pass and reused for every read and write, so a pass can
 * never straddle a pool recycle. ARCHITECTURE.md section 5.3.
 */
import type { Address } from "viem";
import type { MarketOnchain, UnifiedMarket } from "@somnia-chain/markets-sdk";
import type { EcContext } from "./ec/exchange.js";
import { activeMarkets, marketOnchain, outcomeSymbols, isTradable } from "./ec/markets.js";
import { maybeClaim } from "./ec/claim.js";
import { reference, deriveQuotes, compressionTicks, fromTicks, type Book, type TickGrid } from "./pricing.js";
import { Vault, human } from "./vault.js";

export interface LoopConfig {
  halfSpread: number;
  /** Shares per side, human units. */
  quoteSize: number;
  refreshMs: number;
  /** Markets to quote per pass. */
  maxMarkets: number;
}

export interface PassStats {
  markets: number;
  quoted: number;
  skipped: number;
  /** Sum of spread improvement, in ticks, across quoted markets. */
  compressionTicks: bigint;
  /** Book spread before Ballast, in ticks, summed across quoted markets. */
  bookSpreadTicks: bigint;
  errors: string[];
}

/** Live orders we placed, per pool, so they can be cancelled next pass. */
const resting = new Map<string, bigint[]>();

const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/** Snap a human size down to a whole number of lots, in raw units. */
export function quantizeRaw(human_: number, lot: bigint, decimals: number): bigint {
  const [i = "0", f = ""] = human_.toFixed(decimals).split(".");
  const raw = BigInt(i + f.padEnd(decimals, "0"));
  return (raw / lot) * lot;
}

export async function runPass(
  ctx: EcContext,
  vault: Vault,
  cfg: LoopConfig,
  grid: TickGrid,
): Promise<PassStats> {
  const stats: PassStats = {
    markets: 0,
    quoted: 0,
    skipped: 0,
    compressionTicks: 0n,
    bookSpreadTicks: 0n,
    errors: [],
  };

  const markets = await activeMarkets(ctx, { max: cfg.maxMarkets });
  stats.markets = markets.length;

  for (const market of markets) {
    try {
      await quoteOne(ctx, vault, cfg, grid, market, stats);
    } catch (e) {
      stats.errors.push(`${market.symbol}: ${(e as Error).message}`);
    }
  }

  // Claiming signs from the same key as quoting. Two senders on one key race
  // each other's nonce, so it runs INSIDE the loop rather than on a timer —
  // that serialises it for free. ec-core throttles it internally.
  try {
    await maybeClaim(ctx);
  } catch (e) {
    stats.errors.push(`claim: ${(e as Error).message}`);
  }

  return stats;
}

async function quoteOne(
  ctx: EcContext,
  vault: Vault,
  cfg: LoopConfig,
  grid: TickGrid,
  market: UnifiedMarket,
  stats: PassStats,
): Promise<void> {
  // ONE snapshot for the whole pass on this market.
  const oc = await marketOnchain(ctx, market);
  if (!oc) {
    stats.skipped++;
    return;
  }

  // Gate on the on-chain status, never the indexer — it lags by seconds and
  // only `Trading` accepts orders.
  if (!isTradable(oc)) {
    stats.skipped++;
    return;
  }

  const pool = oc.pool as Address;
  if (!(await vault.poolAllowed(pool))) {
    stats.skipped++;
    stats.errors.push(`${market.symbol}: pool ${pool} not allowlisted on the vault`);
    return;
  }

  const { yes } = outcomeSymbols(market);
  const raw = await ctx.exchange.fetchOrderBook(yes, 10);
  const book: Book = { bids: raw.bids as Book["bids"], asks: raw.asks as Book["asks"] };

  const ref = reference(book, grid);
  const quotes = deriveQuotes(ref, cfg.halfSpread, grid);
  if (!quotes) {
    // Already tighter than we would quote. Leave it alone.
    stats.skipped++;
    return;
  }

  const sizeRaw = quantizeRaw(cfg.quoteSize, ctx.config.lot, ctx.config.decimals);
  if (sizeRaw === 0n) {
    stats.skipped++;
    stats.errors.push(`${market.symbol}: quote size is below one lot`);
    return;
  }

  // The ask escrows real YES tokens — there is no naked short. Mint only the
  // shortfall; a complete set moves both legs together so this never changes
  // the imbalance.
  const held = await ctx.exchange.client.getOutcomeBalance({
    outcomeToken: oc.outcomeToken,
    account: vault.address,
    id: oc.yesId,
  });
  if (held < sizeRaw) {
    await vault.mintSet(pool, sizeRaw - held);
  }

  // Clear last pass's quotes before posting new ones.
  const key = pool.toLowerCase();
  const stale = resting.get(key) ?? [];
  if (stale.length) {
    await vault.cancelOrders(pool, stale);
    resting.set(key, []);
  }

  // Expiry is mandatory and capped at the market's own. Set it just past the
  // requote interval so a crashed quoter's orders age off the book by
  // themselves rather than resting with escrow locked.
  const marketExpiryNs = BigInt(Number(market.info.marketType === "BINARY" ? (market.info.expiry ?? 0) : 0)) * 1_000_000_000n;
  const wantExpiryNs = nowNs() + BigInt(cfg.refreshMs * 3) * 1_000_000n;
  const expireNs = marketExpiryNs > 0n && marketExpiryNs < wantExpiryNs ? marketExpiryNs : wantExpiryNs;

  const bidPriceRaw = quotes.bidTicks * grid.tick;
  const askPriceRaw = quotes.askTicks * grid.tick;

  await vault.placeOrder({ pool, isBid: true, price: bidPriceRaw, quantity: sizeRaw, expireNs });
  await vault.placeOrder({ pool, isBid: false, price: askPriceRaw, quantity: sizeRaw, expireNs });

  stats.quoted++;
  const saved = compressionTicks(ref, quotes);
  if (saved !== undefined && ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined) {
    stats.compressionTicks += saved;
    stats.bookSpreadTicks += ref.bookAskTicks - ref.bookBidTicks;
  }

  const was =
    ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined
      ? `${fromTicks(ref.bookBidTicks, grid).toFixed(3)}/${fromTicks(ref.bookAskTicks, grid).toFixed(3)}`
      : "empty";
  console.log(
    `  ${market.symbol.padEnd(26)} was ${was.padEnd(13)} now ${quotes.bid.toFixed(3)}/${quotes.ask.toFixed(3)}` +
      `  (${ref.source})`,
  );
}

/** One-line summary of a pass, for the operator watching the log. */
export function summarise(stats: PassStats, grid: TickGrid): string {
  const parts = [`${stats.quoted}/${stats.markets} quoted`];
  if (stats.skipped) parts.push(`${stats.skipped} skipped`);
  if (stats.bookSpreadTicks > 0n) {
    const before = fromTicks(stats.bookSpreadTicks, grid);
    const saved = fromTicks(stats.compressionTicks, grid);
    const pct = before > 0 ? (saved / before) * 100 : 0;
    parts.push(`spread ${(before * 100).toFixed(2)}c -> ${((before - saved) * 100).toFixed(2)}c (-${pct.toFixed(0)}%)`);
  }
  if (stats.errors.length) parts.push(`${stats.errors.length} error(s)`);
  return parts.join("  ·  ");
}

export { human };
