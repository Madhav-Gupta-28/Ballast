/**
 * Numbers that appear as claims on the site.
 *
 * They live here, once, because an earlier version quoted a stale snapshot
 * ("5,000 markets, 83.5%, 3,834 USDso") that had drifted badly and, worse,
 * summed volume across four different venues whose quote tokens do not share
 * decimals. Every figure below was counted on 2026-09-02 by paging the whole
 * Market table for the mainnet DreamDEX venue only.
 *
 * Reproduce:
 *   curl -s -X POST https://prd.smk.somnia.host/v1/graphql \
 *     -H 'content-type: application/json' \
 *     -d '{"query":"{ Market(where:{marketType:{_eq:\"BINARY\"},venueId:{_eq:\"0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d\"}}, limit:1000, offset:N){ finalized tradeCount cumulativeQuoteVolume } }"}'
 */
export const VENUE_ID = "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d";

export const FACTS = {
  /** Binary markets on the mainnet DreamDEX venue that have finalised. */
  settled: 7875,
  /** Of those, how many never saw a single trade. */
  neverTraded: 6444,
  /** Share of settled markets that never traded. */
  neverTradedPct: 81.8,
  /** Markets that traded at least once. */
  traded: 1431,
  /** Median trade count among the ones that traded at all. */
  medianTrades: 1,
  /** Lifetime quote volume across the venue, in USDso. */
  volumeUsdso: 55_382.61,
  /** The single busiest market in the venue's history. */
  busiestTrades: 36,
  countedOn: "2 Sep 2026",
} as const;

export const n = (x: number) => x.toLocaleString("en-US");
