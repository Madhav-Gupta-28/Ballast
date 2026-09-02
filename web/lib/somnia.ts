/**
 * Reads DreamDEX straight from the indexer and the vault straight from the RPC.
 *
 * No SDK on this path. The indexer already serves the full order book — every
 * open order with its price, remaining size and `side` — and the vault is
 * plain viem, so the page has no reason to carry the trading library.
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { reference, deriveQuotes, compressionTicks, fromTicks, type Book, type TickGrid } from "./pricing";

export const NETWORK = {
  testnet: {
    chainId: 50312,
    rpc: "https://api.infra.testnet.somnia.network",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
    explorer: "https://shannon-explorer.somnia.network",
    venueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
    decimals: 6,
    tick: 1_000n,
    collateralSymbol: "tUSDC",
  },
  mainnet: {
    chainId: 5031,
    rpc: "https://api.infra.mainnet.somnia.network",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
    explorer: "https://explorer.somnia.network",
    venueId: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
    decimals: 18,
    tick: 1_000_000_000_000_000n,
    collateralSymbol: "USDso",
  },
} as const;

export type NetworkName = keyof typeof NETWORK;

/** `side` is the on-chain OrderKind name — a binary book has four of them. */
type Side = "BUY_YES" | "SELL_YES" | "BUY_NO" | "SELL_NO";

interface RawOrder {
  price: string;
  quantityRemaining: string;
  side: Side;
  owner: string;
}

interface RawMarket {
  asset: string;
  intervalSec: string;
  expiry: string;
  binaryPoolAddress: string;
  tradeCount: string;
  orders: RawOrder[];
}

export interface MarketView {
  symbol: string;
  asset: string;
  intervalSec: number;
  expiry: number;
  pool: string;
  tradeCount: number;
  /** Best bid / ask on the YES book, as probabilities. */
  bookBid?: number;
  bookAsk?: number;
  bookSpread?: number;
  /** What Ballast would post here. */
  ourBid?: number;
  ourAsk?: number;
  ourSpread?: number;
  savedPct?: number;
  /** Which side a taker simply cannot trade on right now. */
  gap?: "no-bids" | "no-asks" | "empty";
  /** Best bid is at or above best ask — stale or inconsistent, not a market. */
  crossed: boolean;
  ballastIsQuoting: boolean;
}

async function gql<T>(url: string, query: string): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message ?? "indexer error");
  return j.data as T;
}

/**
 * Build the YES book from open orders.
 *
 * The venue is one book with four sides. On the YES axis a BUY_YES is a bid;
 * a SELL_YES is an ask. A BUY_NO at price p is economically a SELL_YES at
 * 1 - p, and a SELL_NO at p is a BUY_YES at 1 - p — so NO-side orders are
 * folded in at their complement rather than dropped.
 */
function toBook(orders: RawOrder[], decimals: number): Book {
  const one = 10 ** decimals;
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];

  for (const o of orders) {
    const p = Number(o.price) / one;
    const q = Number(o.quantityRemaining) / one;
    if (!(q > 0)) continue;
    switch (o.side) {
      case "BUY_YES":
        bids.push([p, q]);
        break;
      case "SELL_YES":
        asks.push([p, q]);
        break;
      case "SELL_NO":
        bids.push([1 - p, q]);
        break;
      case "BUY_NO":
        asks.push([1 - p, q]);
        break;
    }
  }
  bids.sort((a, b) => b[0] - a[0]);
  asks.sort((a, b) => a[0] - b[0]);
  return { bids, asks };
}

export async function getMarkets(net: NetworkName, halfSpread = 0.005, vault?: string): Promise<MarketView[]> {
  const cfg = NETWORK[net];
  const now = Math.floor(Date.now() / 1000);
  const grid: TickGrid = { tick: cfg.tick, decimals: cfg.decimals };

  const data = await gql<{ Market: RawMarket[] }>(
    cfg.indexer,
    `{ Market(
        where: { marketType: {_eq: "BINARY"}, venueId: {_eq: "${cfg.venueId}"},
                 clobStatus: {_eq: "Trading"}, expiry: {_gt: "${now}"} }
        order_by: { expiry: asc }, limit: 12
      ) {
        asset intervalSec expiry binaryPoolAddress tradeCount
        orders(where: { status: {_eq: "Open"} }, limit: 60) {
          price quantityRemaining side owner
        }
      } }`,
  );

  const vaultLc = vault?.toLowerCase();

  return data.Market.map((m): MarketView => {
    const book = toBook(m.orders, cfg.decimals);
    const ref = reference(book, grid);
    const q = deriveQuotes(ref, halfSpread, grid);

    const twoSided = ref.bookBidTicks !== undefined && ref.bookAskTicks !== undefined;
    const gap: MarketView["gap"] =
      book.bids.length === 0 && book.asks.length === 0
        ? "empty"
        : book.bids.length === 0
          ? "no-bids"
          : book.asks.length === 0
            ? "no-asks"
            : undefined;

    const crossed = ref.source === "crossed";
    // A crossed book has no meaningful width; reporting one invites a reader to
    // treat it as a spread Ballast could improve on.
    const bookSpread =
      twoSided && !crossed ? fromTicks(ref.bookAskTicks! - ref.bookBidTicks!, grid) : undefined;
    const saved = q && twoSided ? compressionTicks(ref, q) : undefined;

    const mins = Math.round(Number(m.intervalSec) / 60);
    return {
      symbol: `${m.asset} ${mins}m`,
      asset: m.asset,
      intervalSec: Number(m.intervalSec),
      expiry: Number(m.expiry),
      pool: m.binaryPoolAddress,
      tradeCount: Number(m.tradeCount ?? 0),
      bookBid: ref.bookBidTicks !== undefined ? fromTicks(ref.bookBidTicks, grid) : undefined,
      bookAsk: ref.bookAskTicks !== undefined ? fromTicks(ref.bookAskTicks, grid) : undefined,
      bookSpread,
      ourBid: q?.bid,
      ourAsk: q?.ask,
      ourSpread: q ? q.ask - q.bid : undefined,
      savedPct:
        saved !== undefined && bookSpread
          ? (Number(saved) / Number(ref.bookAskTicks! - ref.bookBidTicks!)) * 100
          : undefined,
      gap,
      crossed,
      ballastIsQuoting: vaultLc ? m.orders.some((o) => o.owner.toLowerCase() === vaultLc) : false,
    };
  });
}

const vaultAbi = parseAbi([
  "function nav() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function imbalance() view returns (uint256)",
  "function imbalanceCap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function paused() view returns (bool)",
]);

export interface VaultView {
  address: string;
  nav: string;
  sharePrice: string;
  imbalance: string;
  imbalanceCap: string;
  totalSupply: string;
  paused: boolean;
}

export async function getVault(net: NetworkName, address: string): Promise<VaultView | null> {
  const cfg = NETWORK[net];
  // Six reads over six round trips to a ~500ms RPC is three seconds of nothing.
  // Batching folds them into a single request.
  const client = createPublicClient({
    transport: http(cfg.rpc, { batch: { wait: 8 }, timeout: 12_000 }),
  });
  try {
    const read = (functionName: string) =>
      client.readContract({ address: address as Address, abi: vaultAbi, functionName } as never) as Promise<
        bigint | boolean
      >;
    const [nav, sharePrice, imbalance, imbalanceCap, totalSupply, paused] = await Promise.all([
      read("nav"),
      read("sharePrice"),
      read("imbalance"),
      read("imbalanceCap"),
      read("totalSupply"),
      read("paused"),
    ]);
    return {
      address,
      nav: String(nav),
      sharePrice: String(sharePrice),
      imbalance: String(imbalance),
      imbalanceCap: String(imbalanceCap),
      totalSupply: String(totalSupply),
      paused: Boolean(paused),
    };
  } catch {
    return null;
  }
}

/** Raw amount -> display string, without pulling in a formatter. */
export function fmt(raw: string, decimals: number, dp = 2): string {
  const neg = raw.startsWith("-");
  const s = (neg ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(s.length - decimals).slice(0, dp);
  return `${neg ? "-" : ""}${whole}${dp ? `.${frac}` : ""}`;
}
