import { describe, it, expect, vi, beforeEach } from "vitest";
import { quoteOne, quantizeRaw, type LoopConfig, type PassStats } from "./loop.js";
import type { TickGrid } from "./pricing.js";

/**
 * The order of operations in a quoting pass is load-bearing, not stylistic.
 *
 * Escrow leaves the wallet while an order rests and returns on cancel. So
 * inventory must be read AFTER last pass's quotes are pulled — read it before
 * and the YES sitting behind the old ask is invisible, and the vault mints a
 * whole fresh set to replace tokens it already owns. That compounds every pass
 * until collateral runs out.
 */
const GRID: TickGrid = { tick: 1_000n, decimals: 6 };
const CFG: LoopConfig = { halfSpread: 0.005, quoteSize: 1, refreshMs: 60_000, maxMarkets: 10 };
const ONE = 1_000_000n;

function harness(heldAfterCancel: bigint, staleIds: bigint[]) {
  const calls: string[] = [];

  globalThis.fetch = vi.fn(async () => ({
    json: async () => ({ data: { Order: staleIds.map((id) => ({ orderId: String(id) })) } }),
  })) as never;

  const ctx = {
    config: { indexerUrl: "http://indexer", lot: 1n, decimals: 6 },
    exchange: {
      fetchOrderBook: async () => ({ bids: [[0.4, 100]], asks: [[0.6, 100]] }),
      client: {
        getOutcomeBalance: async () => {
          calls.push("readBalance");
          // Escrow has returned by the time this is read — iff cancel ran first.
          return calls.includes("cancelOrders") ? heldAfterCancel : 0n;
        },
      },
    },
  } as never;

  const vault = {
    address: "0xvault",
    poolAllowed: async () => true,
    cancelOrders: async () => {
      calls.push("cancelOrders");
      return null;
    },
    mintSet: async (_p: string, amount: bigint) => {
      calls.push(`mintSet:${amount}`);
      return null;
    },
    placeBinaryOrder: async () => {
      calls.push("placeOrder");
      return null;
    },
  } as never;

  const market = { symbol: "BTC 15m", info: { marketType: "BINARY", expiry: 9_999_999_999 } } as never;
  const onchain = { pool: "0xpool", outcomeToken: "0xot", yesId: 1n, noId: 2n, status: 1 } as never;

  return { ctx, vault, market, onchain, calls };
}

// `quoteOne` resolves the snapshot itself, so stub that module boundary.
vi.mock("./ec/markets.js", async () => {
  const actual = await vi.importActual<typeof import("./ec/markets.js")>("./ec/markets.js");
  return {
    ...actual,
    marketOnchain: async () => ({ pool: "0xpool", outcomeToken: "0xot", yesId: 1n, noId: 2n, status: 1 }),
    isTradable: () => true,
    outcomeSymbols: () => ({ yes: "BTC#YES", no: "BTC#NO" }),
  };
});

const freshStats = (): PassStats => ({
  markets: 0,
  quoted: 0,
  skipped: 0,
  compressionTicks: 0n,
  bookSpreadTicks: 0n,
  unlistedPools: 0,
  cancelled: 0,
  redeemed: 0,
  minted: 0n,
  errors: [],
});

describe("quoting pass ordering", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("pulls stale quotes before reading inventory", async () => {
    const h = harness(ONE, [11n, 12n]);
    await quoteOne(h.ctx, h.vault, CFG, GRID, h.market, freshStats());

    const cancel = h.calls.indexOf("cancelOrders");
    const read = h.calls.indexOf("readBalance");
    expect(cancel).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(cancel);
  });

  it("does not re-mint inventory the escrow just returned", async () => {
    // One share comes back off the cancelled ask; the vault needs one share.
    const h = harness(ONE, [11n]);
    await quoteOne(h.ctx, h.vault, CFG, GRID, h.market, freshStats());

    expect(h.calls.filter((c) => c.startsWith("mintSet"))).toHaveLength(0);
  });

  it("still mints when inventory is genuinely short", async () => {
    const h = harness(0n, []);
    await quoteOne(h.ctx, h.vault, CFG, GRID, h.market, freshStats());

    expect(h.calls.filter((c) => c.startsWith("mintSet"))).toEqual([`mintSet:${ONE}`]);
  });

  it("places both legs after minting", async () => {
    const h = harness(0n, []);
    await quoteOne(h.ctx, h.vault, CFG, GRID, h.market, freshStats());

    const mint = h.calls.findIndex((c) => c.startsWith("mintSet"));
    const firstPlace = h.calls.indexOf("placeOrder");
    expect(firstPlace).toBeGreaterThan(mint);
    expect(h.calls.filter((c) => c === "placeOrder")).toHaveLength(2);
  });
});

describe("quantizeRaw", () => {
  it("snaps down to a whole lot and never up", () => {
    expect(quantizeRaw(1.5, 1_000_000n, 6)).toBe(1_000_000n);
    expect(quantizeRaw(0.9, 1_000_000n, 6)).toBe(0n);
  });
});
