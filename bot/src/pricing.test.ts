import { describe, it, expect } from "vitest";
import {
  normalCdf,
  underlyingPrior,
  reference,
  deriveQuotes,
  toTicks,
  fromTicks,
  toRaw,
  unitTicks,
  compressionTicks,
  type Book,
  type TickGrid,
} from "./pricing.js";

/** Mainnet: 18dp collateral, tick 1e15 => 0.001. */
const G18: TickGrid = { tick: 1_000_000_000_000_000n, decimals: 18 };
/** Testnet: 6dp collateral, tick 1000 => 0.001. */
const G6: TickGrid = { tick: 1_000n, decimals: 6 };
const GRIDS: [string, TickGrid][] = [
  ["6dp testnet", G6],
  ["18dp mainnet", G18],
];

const book = (bids: [number, number][], asks: [number, number][]): Book => ({ bids, asks });

/** The property the venue actually enforces: price must be a whole tick. */
const onGrid = (ticks: bigint, g: TickGrid) => (ticks * g.tick) % g.tick === 0n;

describe("normalCdf", () => {
  it("is exactly 0.5 at zero", () => {
    expect(normalCdf(0)).toBe(0.5);
  });

  it("is symmetric to the accuracy of the approximation", () => {
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 7);
  });

  it("matches known values", () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.645)).toBeCloseTo(0.05, 4);
  });
});

describe("underlyingPrior", () => {
  it("is even odds when spot sits exactly on the strike", () => {
    expect(underlyingPrior(100, 100, 0.6, 900)).toBe(0.5);
  });

  it("rises above the strike and falls below it", () => {
    expect(underlyingPrior(105, 100, 0.6, 900)).toBeGreaterThan(0.5);
    expect(underlyingPrior(95, 100, 0.6, 900)).toBeLessThan(0.5);
  });

  it("converges toward certainty as expiry approaches", () => {
    expect(underlyingPrior(105, 100, 0.6, 60)).toBeGreaterThan(underlyingPrior(105, 100, 0.6, 3600));
  });

  it("falls back to even odds on nonsense input", () => {
    expect(underlyingPrior(0, 100, 0.6, 900)).toBe(0.5);
    expect(underlyingPrior(100, 100, 0, 900)).toBe(0.5);
    expect(underlyingPrior(100, 100, 0.6, 0)).toBe(0.5);
  });
});

describe.each(GRIDS)("grid conversion — %s", (_name, g) => {
  it("round-trips a probability through ticks", () => {
    for (const p of [0.001, 0.05, 0.123, 0.5, 0.777, 0.999]) {
      expect(fromTicks(toTicks(p, g), g)).toBeCloseTo(p, 3);
    }
  });

  it("0.05 lands on the grid — the value the venue rejects as a raw float", () => {
    const t = toTicks(0.05, g);
    expect(onGrid(t, g)).toBe(true);
    expect(fromTicks(t, g)).toBe(0.05);
  });

  it("toRaw never loses a digit", () => {
    expect(toRaw(1, g.decimals)).toBe(10n ** BigInt(g.decimals));
    expect(toRaw(0.5, g.decimals) * 2n).toBe(toRaw(1, g.decimals));
  });

  it("the unit interval is 1000 ticks wide at a 0.001 tick", () => {
    expect(unitTicks(g)).toBe(1000n);
  });
});

describe.each(GRIDS)("reference — %s", (_name, g) => {
  it("prefers the book mid when both sides exist", () => {
    const r = reference(book([[0.4, 10]], [[0.6, 10]]), g);
    expect(r.source).toBe("mid");
    expect(fromTicks(r.ticks, g)).toBeCloseTo(0.5, 3);
  });

  it("anchors on the single live side when the book is one-sided", () => {
    expect(reference(book([[0.4, 10]], []), g).source).toBe("one-sided");
    expect(reference(book([], [[0.6, 10]]), g).source).toBe("one-sided");
  });

  it("uses the underlying only when the book is empty", () => {
    const r = reference(book([], []), g, { spot: 105, strike: 100, sigmaAnnual: 0.6, secondsToExpiry: 900 });
    expect(r.source).toBe("underlying");
    expect(r.ticks).toBeGreaterThan(toTicks(0.5, g));
  });

  it("falls back to even odds with nothing to go on", () => {
    expect(reference(book([], []), g).source).toBe("even-odds");
  });
});

describe.each(GRIDS)("deriveQuotes — %s", (_name, g) => {
  it("sits strictly inside a two-sided book", () => {
    const r = reference(book([[0.4, 10]], [[0.6, 10]]), g);
    const q = deriveQuotes(r, 0.02, g)!;
    expect(q.bidTicks).toBeGreaterThan(r.bookBidTicks!);
    expect(q.askTicks).toBeLessThan(r.bookAskTicks!);
    expect(q.askTicks).toBeGreaterThan(q.bidTicks);
    expect(q.improves).toBe(true);
  });

  it("never quotes wider than the book, even when asked to", () => {
    // Book is 2 cents wide; a 10 cent half-spread must be clamped or Ballast
    // would rest outside the book and never trade.
    const r = reference(book([[0.49, 10]], [[0.51, 10]]), g);
    const q = deriveQuotes(r, 0.1, g)!;
    expect(q.bidTicks).toBeGreaterThan(r.bookBidTicks!);
    expect(q.askTicks).toBeLessThan(r.bookAskTicks!);
  });

  it("declines a book already tight to one tick a side", () => {
    const r = reference(book([[0.499, 10]], [[0.501, 10]]), g);
    expect(deriveQuotes(r, 0.02, g)).toBeNull();
  });

  it("refuses to cross itself", () => {
    const q = deriveQuotes(reference(book([], []), g), 0.02, g)!;
    expect(q.askTicks).toBeGreaterThan(q.bidTicks);
  });

  it("keeps quotes inside the unit interval", () => {
    const q = deriveQuotes(reference(book([], []), g), 0.02, g)!;
    expect(q.bidTicks).toBeGreaterThan(0n);
    expect(q.askTicks).toBeLessThan(unitTicks(g));
  });

  it("produces grid-exact prices", () => {
    const r = reference(book([[0.42, 10]], [[0.58, 10]]), g);
    const q = deriveQuotes(r, 0.03, g)!;
    expect(onGrid(q.bidTicks, g)).toBe(true);
    expect(onGrid(q.askTicks, g)).toBe(true);
    // And the raw units the pool will see are whole multiples of the tick.
    expect((q.bidTicks * g.tick) % g.tick).toBe(0n);
    expect((q.askTicks * g.tick) % g.tick).toBe(0n);
  });

  it("compresses the live testnet spread", () => {
    // A real book read off testnet: 2.9 cents wide.
    const r = reference(book([[0.514, 990]], [[0.543, 990]]), g);
    const q = deriveQuotes(r, 0.005, g)!;
    const saved = compressionTicks(r, q)!;
    expect(saved).toBeGreaterThan(0n);
    expect(q.ask - q.bid).toBeLessThan(0.029);
  });
});

describe.each(GRIDS)("degenerate books — %s", (_name, g) => {
  it("refuses to quote into a crossed book", () => {
    // Bid above ask. Stale or inconsistent data, not a market. Quoting here
    // would cross the resting side rather than rest inside it.
    const r = reference(book([[0.6, 10]], [[0.4, 10]]), g);
    expect(r.source).toBe("crossed");
    expect(deriveQuotes(r, 0.005, g)).toBeNull();
  });

  it("refuses to quote into a locked book", () => {
    const r = reference(book([[0.5, 10]], [[0.5, 10]]), g);
    expect(r.source).toBe("crossed");
    expect(deriveQuotes(r, 0.005, g)).toBeNull();
  });

  it("ignores levels with nothing left on them", () => {
    // A zero-size level is not liquidity; anchoring on it would centre the
    // quote on a price nobody is offering.
    const r = reference(book([[0.9, 0], [0.4, 10]], [[0.1, 0], [0.6, 10]]), g);
    expect(r.source).toBe("mid");
    expect(r.bookBidTicks).toBe(toTicks(0.4, g));
    expect(r.bookAskTicks).toBe(toTicks(0.6, g));
  });

  it("treats an all-zero book as empty", () => {
    const r = reference(book([[0.4, 0]], [[0.6, 0]]), g);
    expect(r.source).toBe("even-odds");
  });
});

describe("compressionTicks", () => {
  it("reports how much tighter the quotes are than the book", () => {
    const r = reference(book([[0.45, 10]], [[0.55, 10]]), G6);
    const q = deriveQuotes(r, 0.02, G6)!;
    expect(compressionTicks(r, q)).toBe(
      r.bookAskTicks! - r.bookBidTicks! - (q.askTicks - q.bidTicks),
    );
  });

  it("is undefined when there was no two-sided book to improve on", () => {
    const r = reference(book([], []), G6);
    const q = deriveQuotes(r, 0.02, G6)!;
    expect(compressionTicks(r, q)).toBeUndefined();
  });
});
