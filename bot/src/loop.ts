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
import { sweepRedemptions } from "./claim.js";
import { reference, deriveQuotes, compressionTicks, fromTicks, type Book, type TickGrid } from "./pricing.js";
import { Vault, human, OrderKind } from "./vault.js";

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
  /** Live markets whose pool the owner has not allowlisted yet. */
  unlistedPools: number;
  /** Stale quotes pulled before requoting. */
  cancelled: number;
  /** Settled positions redeemed back into collateral. */
  redeemed: number;
  errors: string[];
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/** Settled positions are swept on their own cadence, not every pass. */
const SWEEP_INTERVAL_MS = 10 * 60_000;
let lastSweep = 0;

/**
 * The vault's still-open order ids on one pool, from the indexer.
 *
 * The order id is a return value of `placeBinaryOrder`, and a transaction
 * receipt does not carry it — so tracking ids in memory means parsing logs, and
 * loses everything on restart anyway. The indexer already knows, and it is the
 * same source the rest of this bot reads, so ask it.
 */
async function openOrderIds(indexerUrl: string, vault: string, pool: string): Promise<bigint[]> {
  const query = `{ Order(
      where: { owner: {_eq: "${vault.toLowerCase()}"}, status: {_eq: "Open"},
               market: { binaryPoolAddress: {_eq: "${pool.toLowerCase()}"} } }
      limit: 50
    ) { orderId } }`;
  const r = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: { Order?: { orderId: string }[] }; errors?: unknown };
  if (!j.data?.Order) return [];
  return j.data.Order.map((o) => BigInt(o.orderId));
}

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
    unlistedPools: 0,
    cancelled: 0,
    redeemed: 0,
    errors: [],
  };

  // Fetch wide, then keep only what the vault is allowed to trade. The venue
  // spawns a new pool every few minutes, so the newest markets are routinely
  // ones the owner has not allowlisted yet. Quoting what we can beats erroring
  // on what we cannot — run `pnpm setup --allow` to pick the new ones up.
  const all = await activeMarkets(ctx, { max: 40 });
  const allowed: UnifiedMarket[] = [];
  let unlisted = 0;

  for (const m of all) {
    if (allowed.length >= cfg.maxMarkets) break;
    const oc = await marketOnchain(ctx, m);
    if (!oc || !isTradable(oc)) continue;
    if (await vault.poolAllowed(oc.pool as Address)) {
      allowed.push(m);
    } else {
      unlisted++;
    }
  }

  stats.markets = allowed.length;
  stats.unlistedPools = unlisted;

  for (const market of allowed) {
    try {
      await quoteOne(ctx, vault, cfg, grid, market, stats);
    } catch (e) {
      stats.errors.push(`${market.symbol}: ${(e as Error).message}`);
    }
  }

  // Redemption runs INSIDE the loop, not on a timer: it signs from the same
  // key as the quoter, and two senders on one key race each other's nonce.
  //
  // Note this is NOT ec-core's maybeClaim. That redeems the signer's holdings,
  // and the tokens are held by the vault, so it could never have reached them.
  if (Date.now() - lastSweep > SWEEP_INTERVAL_MS) {
    lastSweep = Date.now();
    try {
      const swept = await sweepRedemptions(ctx, vault);
      stats.redeemed = swept.redeemed;
      stats.errors.push(...swept.errors);
    } catch (e) {
      stats.errors.push(`sweep: ${(e as Error).message}`);
    }
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

  // Clear last pass's quotes before posting new ones. Without this the vault
  // ends up with several generations resting at once - order expiry is three
  // refresh intervals - each one escrowing collateral or outcome tokens it can
  // no longer use, and quoting at prices it has since moved away from.
  const stale = await openOrderIds(ctx.config.indexerUrl, vault.address, pool).catch(() => [] as bigint[]);
  if (stale.length) {
    await vault.cancelOrders(pool, stale);
    stats.cancelled += stale.length;
  }

  // Expiry is mandatory and capped at the market's own. Set it just past the
  // requote interval so a crashed quoter's orders age off the book by
  // themselves rather than resting with escrow locked.
  const marketExpiryNs = BigInt(Number(market.info.marketType === "BINARY" ? (market.info.expiry ?? 0) : 0)) * 1_000_000_000n;
  const wantExpiryNs = nowNs() + BigInt(cfg.refreshMs * 3) * 1_000_000n;
  const expireNs = marketExpiryNs > 0n && marketExpiryNs < wantExpiryNs ? marketExpiryNs : wantExpiryNs;

  const bidPriceRaw = quotes.bidTicks * grid.tick;
  const askPriceRaw = quotes.askTicks * grid.tick;

  // Two-sided on the YES book: BUY_YES at the bid, SELL_YES at the ask. By the
  // complement identity that is the same as standing ready to sell NO at
  // 1 - bid and buy NO at 1 - ask, so both kinds of taker find a counterparty.
  await vault.placeBinaryOrder({ pool, kind: OrderKind.BUY_YES, price: bidPriceRaw, quantity: sizeRaw, expireNs });
  await vault.placeBinaryOrder({ pool, kind: OrderKind.SELL_YES, price: askPriceRaw, quantity: sizeRaw, expireNs });

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
  if (stats.cancelled) parts.push(`${stats.cancelled} stale pulled`);
  if (stats.redeemed) parts.push(`${stats.redeemed} redeemed`);
  if (stats.unlistedPools) parts.push(`${stats.unlistedPools} on new pools (run setup --allow)`);
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
