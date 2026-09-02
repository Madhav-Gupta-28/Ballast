/**
 * Reference price and quote placement.
 *
 * Ballast does not forecast. Everything here produces a *reference* to hang a
 * spread on, and a pair of quotes that sit strictly inside whatever the book
 * currently offers.
 *
 * ## Everything below happens in integer ticks
 *
 * Prices reach the pool as integers. Doing the arithmetic in floats and
 * converting at the end does not work: `(0.05).toFixed(18)` is
 * "0.050000000000000003", three wei off the grid, and the pool rejects it with
 * InvalidPrice. Measured on mainnet, only 0.25, 0.50 and 0.75 survive that
 * round-trip out of fifteen ordinary probabilities.
 *
 * So a price here is a COUNT OF TICKS (bigint). Floats appear only for logging
 * and for reading the book, never on the way to a transaction.
 * ARCHITECTURE.md section 6.1.
 */

export interface Book {
  bids: [price: number, size: number][];
  asks: [price: number, size: number][];
}

export type PriceSource = "mid" | "one-sided" | "underlying" | "even-odds" | "crossed";

export interface TickGrid {
  tick: bigint;
  decimals: number;
}

/* ────────────────────────────── grid conversion ────────────────────────────── */

/** Raw collateral units for a human probability, exactly. */
export function toRaw(p: number, decimals: number): bigint {
  const [i = "0", f = ""] = p.toFixed(decimals).split(".");
  return BigInt(i + f.padEnd(decimals, "0"));
}

/**
 * Human probability -> tick count, to the NEAREST tick.
 *
 * Rounding rather than truncating is required, not cosmetic. Prices arrive
 * from the order book as JS numbers, and a float is often a hair below the
 * decimal it prints as: `(0.6).toFixed(18)` is "0.599999999999999978". Expand
 * that to raw units and floor it and 0.6 silently becomes 0.599 — one tick low
 * on every quote, forever.
 *
 * Tick counts are small (1000 across the whole range at a 0.001 tick), so the
 * division is exact in double precision and `Math.round` recovers the intent.
 */
export function toTicks(p: number, g: TickGrid): bigint {
  if (!(p > 0)) return 0n;
  const tickHuman = Number(g.tick) / 10 ** g.decimals;
  if (!(tickHuman > 0)) return 0n;
  return BigInt(Math.round(p / tickHuman));
}

/**
 * Tick count -> human probability, for display only.
 *
 * The sign has to come off before the digits are padded. A crossed book gives a
 * negative tick count, and "-43000" padded and sliced yields "0.-43000", which
 * is NaN — the spread column rendered "NaNc" until this was handled.
 */
export function fromTicks(ticks: bigint, g: TickGrid): number {
  const neg = ticks < 0n;
  const raw = (neg ? -ticks : ticks) * g.tick;
  const s = raw.toString().padStart(g.decimals + 1, "0");
  const whole = s.slice(0, s.length - g.decimals);
  const frac = s.slice(s.length - g.decimals);
  return Number(`${neg ? "-" : ""}${whole}.${frac}`);
}

/** Ticks in the whole (0,1) range. */
export const unitTicks = (g: TickGrid): bigint => toRaw(1, g.decimals) / g.tick;

/* ─────────────────────────────── the reference ─────────────────────────────── */

export interface Reference {
  /** Centre of the quote, in ticks. */
  ticks: bigint;
  source: PriceSource;
  /** Prevailing best bid/ask in ticks, when the book has that side. */
  bookBidTicks?: bigint;
  bookAskTicks?: bigint;
}

/** Standard normal CDF, Abramowitz & Stegun 7.1.26. Max abs error 7.5e-8. */
export function normalCdf(x: number): number {
  if (x === 0) return 0.5; // the approximation is not exactly symmetric at 0
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * Risk-neutral probability that spot finishes above the strike.
 *
 *   p = Phi( ln(S/K) / (sigma * sqrt(tau)) )
 *
 * Drift is omitted deliberately: over a 5- to 60-minute window it is orders of
 * magnitude smaller than the diffusion term, and pretending to know it would be
 * a forecast. This is a reference for spread placement, not a view.
 */
export function underlyingPrior(spot: number, strike: number, sigmaAnnual: number, secondsToExpiry: number): number {
  if (!(spot > 0) || !(strike > 0) || !(sigmaAnnual > 0) || !(secondsToExpiry > 0)) return 0.5;
  const tau = secondsToExpiry / (365 * 24 * 3600);
  const denom = sigmaAnnual * Math.sqrt(tau);
  if (!(denom > 0)) return 0.5;
  return clamp01(normalCdf(Math.log(spot / strike) / denom));
}

export const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/**
 * Best price on a side, ignoring levels with nothing left on them.
 *
 * A zero-size level is not liquidity. Taking one as the top of book would put
 * the whole quote around a price nobody is actually offering.
 */
const best = (levels: [number, number][]): number | undefined => {
  for (const [price, size] of levels) if (size > 0) return price;
  return undefined;
};
export const bestBid = (b: Book) => best(b.bids);
export const bestAsk = (b: Book) => best(b.asks);

/**
 * Where to centre the quotes.
 *
 * A live two-sided book is the market's own opinion and beats any model we
 * could run; only when it is absent do we reach for the underlying.
 */
export function reference(
  book: Book,
  g: TickGrid,
  opts: { spot?: number; strike?: number; sigmaAnnual?: number; secondsToExpiry?: number } = {},
): Reference {
  const b = bestBid(book);
  const a = bestAsk(book);

  if (b !== undefined && a !== undefined) {
    const bt = toTicks(b, g);
    const at = toTicks(a, g);

    // A crossed or locked book (bid >= ask) is not a market, it is stale or
    // inconsistent data. Falling through to the one-sided branch would leave
    // `bookAskTicks` undefined, so `deriveQuotes` would have nothing to clamp
    // against and would happily quote straight through the resting side.
    // Refuse instead.
    if (at <= bt) return { ticks: (bt + at) / 2n, source: "crossed", bookBidTicks: bt, bookAskTicks: at };

    return { ticks: (bt + at) / 2n, source: "mid", bookBidTicks: bt, bookAskTicks: at };
  }

  if (b !== undefined) {
    return { ticks: toTicks(clamp01(b + 0.01), g), source: "one-sided", bookBidTicks: toTicks(b, g) };
  }
  if (a !== undefined) {
    return { ticks: toTicks(clamp01(a - 0.01), g), source: "one-sided", bookAskTicks: toTicks(a, g) };
  }

  const { spot, strike, sigmaAnnual, secondsToExpiry } = opts;
  if (spot && strike && sigmaAnnual && secondsToExpiry) {
    return { ticks: toTicks(underlyingPrior(spot, strike, sigmaAnnual, secondsToExpiry), g), source: "underlying" };
  }

  return { ticks: toTicks(0.5, g), source: "even-odds" };
}

/* ──────────────────────────────── the quotes ───────────────────────────────── */

export interface Quotes {
  bidTicks: bigint;
  askTicks: bigint;
  /** Display only. Never send these. */
  bid: number;
  ask: number;
  improves: boolean;
}

/**
 * Derive a two-sided quote around `ref`.
 *
 * The half-spread is capped so the quotes land strictly inside a prevailing
 * two-sided book: quoting at or outside it would never be hit, and quoting
 * through it would make Ballast a taker rather than the counterparty.
 *
 * Returns null when there is no room left — a book already tight to one tick a
 * side is one Ballast should leave alone.
 */
export function deriveQuotes(ref: Reference, halfSpread: number, g: TickGrid, minHalfSpreadTicks = 1n): Quotes | null {
  // Never quote into a book that is crossed or locked.
  if (ref.source === "crossed") return null;

  let h = toTicks(halfSpread, g);

  // Never rest outside the prevailing book: cap the half-spread so both legs
  // improve it by at least one tick.
  if (ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined) {
    const room = (ref.bookAskTicks - ref.bookBidTicks) / 2n - 1n;
    if (room < minHalfSpreadTicks) return null;
    if (h > room) h = room;
  }
  if (h < minHalfSpreadTicks) return null;

  const bidTicks = ref.ticks - h;
  const askTicks = ref.ticks + h;
  const top = unitTicks(g);

  if (bidTicks <= 0n || askTicks >= top || askTicks <= bidTicks) return null;

  // Strictly inside, on both sides.
  if (ref.bookBidTicks !== undefined && bidTicks <= ref.bookBidTicks) return null;
  if (ref.bookAskTicks !== undefined && askTicks >= ref.bookAskTicks) return null;

  return {
    bidTicks,
    askTicks,
    bid: fromTicks(bidTicks, g),
    ask: fromTicks(askTicks, g),
    improves: ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined,
  };
}

/** How much tighter our quotes are than the book, in ticks. */
export function compressionTicks(ref: Reference, q: Quotes): bigint | undefined {
  if (ref.bookBidTicks === undefined || ref.bookAskTicks === undefined) return undefined;
  return ref.bookAskTicks - ref.bookBidTicks - (q.askTicks - q.bidTicks);
}
