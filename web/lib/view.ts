import { getMarkets, getVault, NETWORK, type MarketView } from "@/lib/somnia";

export const NET = "testnet" as const;
export const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
export const HALF_SPREAD = 0.005;
export const cfg = NETWORK[NET];

export interface Snapshot {
  markets: MarketView[];
  quotable: MarketView[];
  vault: Awaited<ReturnType<typeof getVault>>;
  feedError: string | null;
  meanBook: number;
  meanOurs: number;
  savedPct: number;
  gaps: number;
  untraded: number;
  mid: number;
  stamp: string;
}

/**
 * The indexer answers in anywhere from 500ms to 1.8s and the RPC takes ~500ms
 * per round trip, so the two go out together rather than one after the other,
 * and the result is held for a few seconds — long enough that moving between
 * pages is instant, short enough that the book on screen is still the book.
 */
const TTL_MS = 4_000;
let held: { at: number; value: Promise<Snapshot> } | null = null;

export function snapshot(): Promise<Snapshot> {
  if (held && Date.now() - held.at < TTL_MS) return held.value;
  const value = read();
  held = { at: Date.now(), value };
  // A failed read must not be cached as if it were good.
  value.catch(() => {
    if (held?.value === value) held = null;
  });
  return value;
}

async function read(): Promise<Snapshot> {
  const [marketsResult, vault] = await Promise.all([
    getMarkets(NET, HALF_SPREAD, VAULT).then(
      (m) => ({ markets: m, feedError: null as string | null }),
      (e: Error) => ({ markets: [] as MarketView[], feedError: e.message }),
    ),
    VAULT ? getVault(NET, VAULT) : Promise.resolve(null),
  ]);
  const { markets, feedError } = marketsResult;

  const quotable = markets.filter(
    (m) =>
      m.bookBid !== undefined && m.bookAsk !== undefined && m.ourBid !== undefined && m.ourAsk !== undefined,
  );
  const mean = (f: (m: MarketView) => number) =>
    quotable.length ? quotable.reduce((a, m) => a + f(m), 0) / quotable.length : 0;

  const meanBook = mean((m) => m.bookSpread!);
  const meanOurs = mean((m) => m.ourSpread!);

  return {
    markets,
    quotable,
    vault,
    feedError,
    meanBook,
    meanOurs,
    savedPct: meanBook > 0 ? ((meanBook - meanOurs) / meanBook) * 100 : 0,
    gaps: markets.filter((m) => m.gap).length,
    untraded: markets.filter((m) => m.tradeCount === 0).length,
    mid: mean((m) => (m.bookBid! + m.bookAsk!) / 2),
    stamp: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
  };
}

export const cents = (p?: number) => (p === undefined ? "—" : `${(p * 100).toFixed(2)}c`);
export const prob = (p?: number) => (p === undefined ? "—" : p.toFixed(3));

export function countdown(expiry: number): string {
  const s = expiry - Math.floor(Date.now() / 1000);
  if (s <= 0) return "settling";
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`;
}
