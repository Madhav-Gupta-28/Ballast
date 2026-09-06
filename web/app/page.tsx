import Link from "next/link";
import { Suspense } from "react";
import { fmt } from "@/lib/somnia";
import { snapshot, cfg } from "@/lib/view";
import { FACTS, n } from "@/lib/facts";
import SpreadLab, { type LabMarket } from "@/components/SpreadLab";
import EndLine from "@/components/EndLine";
import Rise from "@/components/Rise";
import { SkeletonStats, SkeletonPanel } from "@/components/Skeleton";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** Everything that has to wait on the venue lives here, behind Suspense. */
async function LiveProof() {
  const s = await snapshot();
  const lab: LabMarket[] = s.quotable.slice(0, 6).map((m) => ({
    symbol: m.symbol,
    asset: m.asset,
    window: m.symbol.replace(m.asset, "").trim(),
    bookBid: m.bookBid!,
    bookAsk: m.bookAsk!,
  }));

  return (
    <>
      <SpreadLab markets={lab} grid={{ tick: cfg.tick, decimals: cfg.decimals }} />
      <div className="stats" style={{ marginTop: 20 }}>
        <div className="stat">
          <div className="v">
            {s.vault ? fmt(s.vault.nav, cfg.decimals) : "—"}
            <small>{cfg.collateralSymbol}</small>
          </div>
          <div className="k">In the vault</div>
        </div>
        <div className="stat">
          <div className="v accent">{s.markets.length}</div>
          <div className="k">Markets quoted</div>
        </div>
        <div className="stat">
          <div className="v">{s.quotable.length ? `${s.savedPct.toFixed(0)}%` : "—"}</div>
          <div className="k">Tighter than the venue</div>
        </div>
        <div className="stat">
          <div className={`v ${s.gaps ? "amber" : ""}`}>
            {s.gaps}
            <small>/ {s.markets.length}</small>
          </div>
          <div className="k">Still one-sided</div>
        </div>
      </div>

      {/* Zeroes here would read as "this does nothing" rather than "the venue is
          not answering", which is the opposite of true and the worse of the two
          things to leave a reader believing. */}
      {s.feedDown && (
        <p className="note" style={{ marginTop: 18 }}>
          Those counts are zero because Somnia&rsquo;s testnet indexer is not answering right now
          ({s.feedError}) — not because there is nothing to quote. The vault figure beside them
          comes from the RPC and is current. The mainnet numbers further down were counted from the
          production indexer and do not depend on it.
        </p>
      )}
    </>
  );
}

export default function Home() {
  return (
    <>
      <section className="section first">
        <div className="wrap">
          <p className="eyebrow">Built on Somnia · DreamDEX</p>
            <h1 className="display">
              The order book is empty. <em>Ballast is the other side.</em>
            </h1>
            <p className="lede">
              A pooled market maker for prediction markets on Somnia. Anyone can fund it, it quotes both
              sides of every market, and because one YES plus one NO always pays exactly 1, it cannot be
              picked off.
            </p>
            <div style={{ marginTop: 38 }}>
              <Link className="btn primary" href="/app">
                Supply the vault <span className="arr">→</span>
              </Link>
            </div>
        </div>
      </section>

      {/* the problem, with numbers that were counted */}
      <section className="section">
        <div className="wrap narrow center">
          <Rise>
            <p className="eyebrow dim">The problem</p>
            <h2 className="h big">
              {n(FACTS.settled)} markets. <em>{n(FACTS.neverTraded)} never traded.</em>
            </h2>
            <p className="lede center">
              DreamDEX lets you bet on where BTC and ETH close, in windows from five minutes to a day.
              Somnia runs it, and it works — but <strong>{FACTS.neverTradedPct}% of its markets have
              settled without a single trade</strong>, because nobody was there to take the other side.
              Of the {n(FACTS.traded)} that did trade, the median traded <strong>once</strong>.
            </p>
            <p className="sub center">
              Counted on the mainnet venue, {FACTS.countedOn} · {n(Math.round(FACTS.volumeUsdso))} USDso
              of volume in its entire history
            </p>
          </Rise>
        </div>
      </section>

      {/* the interactive proof */}
      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">The fix</p>
              <h2 className="h">Ballast quotes both sides, tighter</h2>
              <p className="lede center">
                Drag the slider and watch where it would sit in a real market, right now.
              </p>
            </div>
          </Rise>
          <div>
            <div style={{ marginTop: 46 }}>
              <Suspense
                fallback={
                  <>
                    <SkeletonPanel height={286} />
                    <div style={{ marginTop: 20 }}>
                      <SkeletonStats />
                    </div>
                  </>
                }
              >
                <LiveProof />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <section className="section last">
        <div className="wrap narrow center">
          <Rise>
            <p className="eyebrow dim">You</p>
            <h2 className="h">
              Ballast does the trading. <em>You just fund it.</em>
            </h2>
            <p className="lede center">
              Deposit and you own a share. Nothing to learn, nothing to watch.
            </p>
            <div style={{ marginTop: 34 }}>
              <Link className="btn primary" href="/app">
                Open the app <span className="arr">→</span>
              </Link>
            </div>
          </Rise>
          <EndLine />
        </div>
      </section>
    </>
  );
}
