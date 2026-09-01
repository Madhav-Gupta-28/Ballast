/**
 * ballast shadow — what Ballast would quote, without a vault and without keys.
 *
 * Reads the live books, derives the quotes the loop would post, and reports how
 * much tighter they are. Nothing is signed and nothing is deployed, so this is
 * safe to run against mainnet as well as testnet.
 *
 * It is also the measurement the demo rests on: the "before" number comes from
 * the venue's own book, not from us.
 */
import { createExchange, shutdown } from "./ec/exchange.js";
import { activeMarkets, marketOnchain, outcomeSymbols, isTradable } from "./ec/markets.js";
import { reference, deriveQuotes, compressionTicks, fromTicks, type Book, type TickGrid } from "./pricing.js";

const num = (k: string, fallback: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const cents = (p: number) => `${(p * 100).toFixed(2)}c`;
/** Market symbols vary in length; keep the columns readable. */
const name = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s).padEnd(29);

async function main() {
  const ctx = createExchange();
  const { config } = ctx;
  const grid: TickGrid = { tick: config.tick, decimals: config.decimals };
  const halfSpread = num("MM_HALF_SPREAD", 0.005);

  const markets = await activeMarkets(ctx, { max: num("MM_MAX_MARKETS", 12) });

  console.log(`\nballast shadow — ${config.network}, half-spread ±${halfSpread}\n`);
  console.log(
    `  ${"market".padEnd(29)}${"book".padEnd(16)}${"ballast".padEnd(16)}${"spread".padEnd(18)}saved`,
  );
  console.log(`  ${"-".repeat(92)}`);

  let bookTotal = 0n;
  let savedTotal = 0n;
  let quotable = 0;
  let untradable = 0;

  for (const m of markets) {
    const oc = await marketOnchain(ctx, m);
    if (!oc || !isTradable(oc)) continue;

    const { yes } = outcomeSymbols(m);
    const raw = await ctx.exchange.fetchOrderBook(yes, 10).catch(() => ({ bids: [], asks: [] }));
    const book: Book = { bids: raw.bids as Book["bids"], asks: raw.asks as Book["asks"] };

    const ref = reference(book, grid);
    const q = deriveQuotes(ref, halfSpread, grid);

    const twoSided = ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined;
    if (!twoSided) untradable++;

    const bookStr = twoSided
      ? `${fromTicks(ref.bookBidTicks!, grid).toFixed(3)}/${fromTicks(ref.bookAskTicks!, grid).toFixed(3)}`
      : ref.bookBidTicks !== undefined
        ? `${fromTicks(ref.bookBidTicks, grid).toFixed(3)}/  —  `
        : ref.bookAskTicks !== undefined
          ? `  —  /${fromTicks(ref.bookAskTicks, grid).toFixed(3)}`
          : "empty";

    if (!q) {
      console.log(`  ${name(m.symbol)}${bookStr.padEnd(16)}${"— already tight".padEnd(16)}`);
      continue;
    }

    quotable++;
    const ours = `${q.bid.toFixed(3)}/${q.ask.toFixed(3)}`;
    const oursSpread = q.ask - q.bid;

    let spreadStr: string;
    let savedStr = "";
    if (twoSided) {
      const bookSpread = ref.bookAskTicks! - ref.bookBidTicks!;
      const saved = compressionTicks(ref, q)!;
      bookTotal += bookSpread;
      savedTotal += saved;
      spreadStr = `${cents(fromTicks(bookSpread, grid))} -> ${cents(oursSpread)}`;
      savedStr = `-${((Number(saved) / Number(bookSpread)) * 100).toFixed(0)}%`;
    } else {
      spreadStr = `none -> ${cents(oursSpread)}`;
      savedStr = "first quote";
    }

    console.log(`  ${name(m.symbol)}${bookStr.padEnd(16)}${ours.padEnd(16)}${spreadStr.padEnd(18)}${savedStr}`);
  }

  console.log();
  if (untradable > 0) {
    console.log(`  ${untradable} market(s) have no two-sided book — a taker there cannot be filled at any price.`);
  }
  if (bookTotal > 0n) {
    const before = fromTicks(bookTotal, grid) / quotable;
    const after = fromTicks(bookTotal - savedTotal, grid) / quotable;
    console.log(
      `  Across ${quotable} quotable market(s): mean spread ${cents(before)} -> ${cents(after)} ` +
        `(-${(((before - after) / before) * 100).toFixed(0)}%).`,
    );
  }
  console.log();

  await shutdown(ctx);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  ${e?.message ?? e}\n`);
  process.exit(1);
});
