import Link from "next/link";
import { fmt } from "@/lib/somnia";
import { snapshot, cfg, cents } from "@/lib/view";
import { HeroRail } from "@/components/SpreadRail";
import Rise from "@/components/Rise";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function Home() {
  const s = await snapshot();
  const rail = {
    bookBid: s.mid - s.meanBook / 2,
    bookAsk: s.mid + s.meanBook / 2,
    ourBid: s.mid - s.meanOurs / 2,
    ourAsk: s.mid + s.meanOurs / 2,
  };

  return (
    <>
      {/* ── hero ── */}
      <section className="section">
        <div className="wrap">
          <Rise>
            <p className="eyebrow">Built on Somnia · DreamDEX</p>
            <h1 className="display">
              Every market needs someone on <em>the other side.</em>
            </h1>
            <p className="lede">
              On DreamDEX, usually nobody is. Ballast always quotes both ways — and it cannot be picked
              off, because one unit of collateral mints one YES and one NO, and that pair is worth exactly
              one unit at every resolution.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap" }}>
              <Link className="btn primary" href="/app">
                Supply the vault <span className="arr">→</span>
              </Link>
              <Link className="btn outline" href="/how-it-works">
                How it works
              </Link>
            </div>
          </Rise>
        </div>
      </section>

      {/* ── the tell ── */}
      <section className="section">
        <div className="wrap narrow center">
          <Rise>
            <p className="eyebrow dim">The venue</p>
            <h2 className="h">
              5,000 markets settled. <em>83.5% never traded.</em>
            </h2>
            <p className="lede center">
              Lifetime volume is 3,834 USDso. The busiest market in the venue&apos;s history did 100 trades
              totalling one cent. These books are not thin — they are empty.
            </p>
          </Rise>
        </div>
      </section>

      {/* ── live proof ── */}
      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="inst">
              <div className="inst-head">
                <span className="t">Spread · live</span>
                <span className="r">{s.stamp}</span>
              </div>
              <div className="inst-body">
                {s.quotable.length > 0 ? (
                  <HeroRail
                    {...rail}
                    caption={`mean of ${s.quotable.length} live two-sided market${s.quotable.length === 1 ? "" : "s"}`}
                  />
                ) : (
                  <p className="panel-empty">
                    {s.feedError ? `Could not read the venue: ${s.feedError}` : "No two-sided market open."}
                  </p>
                )}
                <div className="readout">
                  <div className="big">{s.quotable.length ? `${s.savedPct.toFixed(0)}%` : "—"}</div>
                  <p className="cap">
                    tighter than the venue. It quotes <strong>{cents(s.meanBook)}</strong> wide; Ballast
                    quotes <strong>{cents(s.meanOurs)}</strong>, strictly inside on both sides.
                  </p>
                </div>
              </div>
            </div>
          </Rise>

          <Rise delay={80}>
            <div className="stats" style={{ marginTop: 16 }}>
              <div className="stat">
                <div className="v">
                  {s.vault ? fmt(s.vault.nav, cfg.decimals) : "—"}
                  <small>{cfg.collateralSymbol}</small>
                </div>
                <div className="k">Vault NAV</div>
              </div>
              <div className="stat">
                <div className="v">{s.vault ? fmt(s.vault.sharePrice, 18, 4) : "—"}</div>
                <div className="k">Share price</div>
              </div>
              <div className="stat">
                <div className="v accent">{s.markets.length}</div>
                <div className="k">Windows quoted</div>
              </div>
              <div className="stat">
                <div className={`v ${s.gaps ? "amber" : ""}`}>
                  {s.gaps}
                  <small>/ {s.markets.length}</small>
                </div>
                <div className="k">Untradable side</div>
              </div>
            </div>
          </Rise>
        </div>
      </section>

      {/* ── close ── */}
      <section className="section">
        <div className="wrap narrow center">
          <Rise>
            <h2 className="h">Ballast is the trader. You are the capital.</h2>
            <p className="lede center">
              Deposit, and the quoter posts on your behalf. There is no trading interface to learn, because
              there is nothing for you to trade.
            </p>
            <div style={{ marginTop: 30 }}>
              <Link className="btn primary" href="/app">
                Open the app <span className="arr">→</span>
              </Link>
            </div>
          </Rise>
        </div>
      </section>
    </>
  );
}
