import { getMarkets, getVault, fmt, NETWORK, type MarketView } from "@/lib/somnia";
import VaultPanel from "@/components/VaultPanel";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const NET = "testnet" as const;
const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const HALF_SPREAD = 0.005;

const cents = (p?: number) => (p === undefined ? "—" : `${(p * 100).toFixed(2)}c`);
const prob = (p?: number) => (p === undefined ? "—" : p.toFixed(3));

function countdown(expiry: number): string {
  const s = expiry - Math.floor(Date.now() / 1000);
  if (s <= 0) return "settling";
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`;
}

function GapCell({ m }: { m: MarketView }) {
  if (m.gap === "empty") return <span className="pill gap">no book</span>;
  if (m.gap === "no-bids") return <span className="pill gap">cannot sell</span>;
  if (m.gap === "no-asks") return <span className="pill gap">cannot buy</span>;
  return <span style={{ color: "var(--muted)" }}>—</span>;
}

export default async function Page() {
  const cfg = NETWORK[NET];
  // An indexer failure and a venue with nothing live look identical if both
  // collapse to an empty array. They are very different things to show.
  let markets: MarketView[] = [];
  let feedError: string | null = null;
  try {
    markets = await getMarkets(NET, HALF_SPREAD, VAULT);
  } catch (e) {
    feedError = (e as Error).message;
  }
  const vault = VAULT ? await getVault(NET, VAULT) : null;

  const quotable = markets.filter((m) => m.bookSpread !== undefined && m.ourSpread !== undefined);
  const meanBook = quotable.length ? quotable.reduce((a, m) => a + m.bookSpread!, 0) / quotable.length : 0;
  const meanOurs = quotable.length ? quotable.reduce((a, m) => a + m.ourSpread!, 0) / quotable.length : 0;
  const savedPct = meanBook > 0 ? ((meanBook - meanOurs) / meanBook) * 100 : 0;
  const gaps = markets.filter((m) => m.gap).length;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const untraded = markets.filter((m) => m.tradeCount === 0).length;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Ballast</h1>
          <span className="tag">DreamDEX event contracts · Somnia {NET}</span>
        </div>
        <p className="lede">
          A pooled counterparty that is always willing to take the other side, so the book is never empty.
          One unit of collateral mints one YES and one NO, and that pair is worth exactly one unit at every
          resolution — so holding both is riskless, and the vault&apos;s only exposure is the imbalance
          between them.
        </p>

        <div className="headgrid">
          <div className="headline">
            <div className="big">{quotable.length ? `${savedPct.toFixed(0)}%` : "—"}</div>
            <div className="side">
              <h2>tighter than the venue &mdash; live, right now</h2>
              <p>
                The venue quotes <strong>{cents(meanBook)}</strong> wide. Ballast quotes{" "}
                <strong>{cents(meanOurs)}</strong>, strictly inside on both sides, across{" "}
                <strong>
                  {quotable.length} two-sided market{quotable.length === 1 ? "" : "s"}
                </strong>
                {gaps > 0 && (
                  <>
                    {" "}
                    &mdash; and {gaps} more where one side of the book is empty, so a taker cannot be
                    filled there at any price
                  </>
                )}
                .
              </p>
              <p className="srcline">
                Read from the DreamDEX indexer at {stamp}, priced by the same module the quoter posts
                with. Reload to recompute it against the live book.
              </p>
            </div>
          </div>

          <VaultPanel vault={VAULT} />
        </div>

        <div className="stats">
          <div className="stat">
            <div className="k">Vault NAV</div>
            <div className="v">
              {vault ? fmt(vault.nav, cfg.decimals) : "—"}{" "}
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{cfg.collateralSymbol}</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">Share price</div>
            <div className="v">{vault ? fmt(vault.sharePrice, 18, 4) : "—"}</div>
          </div>
          <div className="stat">
            <div className="k">Imbalance</div>
            <div className="v sea">
              {vault ? `${fmt(vault.imbalance, cfg.decimals, 1)} / ${fmt(vault.imbalanceCap, cfg.decimals, 0)}` : "—"}
            </div>
          </div>
          <div className="stat">
            <div className="k">Untradable side</div>
            <div className={`v ${gaps ? "warn" : ""}`}>
              {gaps} / {markets.length}
            </div>
          </div>
        </div>
      </header>

      <section>
        <h3 className="sec">Live markets</h3>
        <p className="sub">
          Every open BTC and ETH window on the DreamDEX venue, with the book as it stands and the quote
          Ballast derives for it. A market flagged <em>cannot buy</em> or <em>cannot sell</em> has no resting
          orders on that side at all — a taker there cannot be filled at any price.
        </p>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Expires</th>
                <th className="num">Book</th>
                <th className="num">Ballast</th>
                <th className="num">Spread</th>
                <th style={{ width: 110 }}>Saved</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: feedError ? "var(--warn)" : "var(--muted)" }}>
                    {feedError
                      ? `Could not read the venue: ${feedError}`
                      : "No live markets on this venue right now."}
                  </td>
                </tr>
              )}
              {markets.map((m) => (
                <tr key={m.pool}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{m.symbol}</span>{" "}
                    {m.ballastIsQuoting && <span className="pill live">quoting</span>}
                  </td>
                  <td className="mono" style={{ color: "var(--ink-2)" }}>
                    {countdown(m.expiry)}
                  </td>
                  <td className="num mono" style={{ color: "var(--ink-2)" }}>
                    {prob(m.bookBid)} / {prob(m.bookAsk)}
                  </td>
                  <td className="num mono">
                    {m.ourBid !== undefined ? (
                      <span style={{ color: "var(--sea)" }}>
                        {prob(m.ourBid)} / {prob(m.ourAsk)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td className="num mono">
                    <span style={{ color: "var(--muted)" }}>{cents(m.bookSpread)}</span>
                    {m.ourSpread !== undefined && (
                      <>
                        {" → "}
                        <span style={{ color: "var(--sea)" }}>{cents(m.ourSpread)}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {m.savedPct !== undefined ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="bar">
                          <i style={{ width: `${Math.min(100, m.savedPct)}%` }} />
                        </div>
                        <span className="mono" style={{ fontSize: 12, color: "var(--sea)" }}>
                          {m.savedPct.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <GapCell m={m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="note">
          {untraded > 0 && (
            <>
              {untraded} of these {markets.length} markets {untraded === 1 ? "has" : "have"} never seen a
              single trade.{" "}
            </>
          )}
          Across 5,000 settled markets on mainnet, 83.5% never traded at all and lifetime volume is 3,834
          USDso — the busiest market in the venue&apos;s history did 100 trades totalling one cent.
        </p>
      </section>

      <footer>
        {vault ? (
          <>
            Vault{" "}
            <a href={`${cfg.explorer}/address/${vault.address}`} target="_blank" rel="noreferrer">
              {vault.address.slice(0, 10)}…{vault.address.slice(-6)}
            </a>{" "}
            on Somnia {NET}. {vault.paused && "PAUSED. "}
          </>
        ) : (
          <>Vault not configured — set NEXT_PUBLIC_VAULT_ADDRESS. </>
        )}
        Quotes shown are derived by the same module the quoter posts with.
      </footer>
    </div>
  );
}
