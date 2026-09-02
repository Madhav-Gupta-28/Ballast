import type { Metadata } from "next";
import type { MarketView } from "@/lib/somnia";
import { snapshot, cfg, cents, prob, countdown } from "@/lib/view";
import { MiniRail } from "@/components/SpreadRail";
import { Suspense } from "react";
import Rise from "@/components/Rise";
import { SkeletonStats, SkeletonPanel } from "@/components/Skeleton";
import EndLine from "@/components/EndLine";

export const metadata: Metadata = { title: "Markets — Ballast" };
export const revalidate = 0;
export const dynamic = "force-dynamic";

function Status({ m }: { m: MarketView }) {
  if (m.gap === "empty") return <span className="pill gap">no book</span>;
  if (m.crossed) return <span className="pill gap">crossed</span>;
  if (m.gap === "no-bids") return <span className="pill gap">cannot sell</span>;
  if (m.gap === "no-asks") return <span className="pill gap">cannot buy</span>;
  if (m.ballastIsQuoting) return <span className="pill live">quoting</span>;
  return <span className="pill none">open</span>;
}

async function LiveTable() {
  const s = await snapshot();
  return (
    <>
      <div className="stats" style={{ marginTop: 40 }}>
        <div className="stat">
          <div className="v">{s.markets.length}</div>
          <div className="k">Open markets</div>
        </div>
        <div className="stat">
          <div className="v">{cents(s.meanBook)}</div>
          <div className="k">Venue charges</div>
        </div>
        <div className="stat">
          <div className="v accent">{cents(s.meanOurs)}</div>
          <div className="k">Ballast charges</div>
        </div>
        <div className="stat">
          <div className={`v ${s.untraded ? "amber" : ""}`}>
            {s.untraded}
            <small>/ {s.markets.length}</small>
          </div>
          <div className="k">Never traded</div>
        </div>
      </div>

      <div className="tablewrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Expires</th>
              <th className="num">Book</th>
              <th className="num">Ballast</th>
              <th>Inside</th>
              <th className="num">Spread</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {s.markets.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: s.feedError ? "var(--amber)" : "var(--muted)" }}>
                  {s.feedError
                    ? `Could not read the venue: ${s.feedError}`
                    : "No live markets on this venue right now."}
                </td>
              </tr>
            )}
            {s.markets.map((m) => {
              const full =
                m.bookBid !== undefined &&
                m.bookAsk !== undefined &&
                m.ourBid !== undefined &&
                m.ourAsk !== undefined;
              return (
                <tr key={m.pool}>
                  <td>
                    <span className="sym">
                      {m.asset}
                      <span className="win">{m.symbol.replace(m.asset, "").trim()}</span>
                    </span>
                  </td>
                  <td className="tnum" style={{ color: "var(--ink-3)" }}>
                    {countdown(m.expiry)}
                  </td>
                  <td className="num tnum slack">
                    {prob(m.bookBid)} / {prob(m.bookAsk)}
                  </td>
                  <td className="num tnum ours">
                    {m.ourBid !== undefined ? `${prob(m.ourBid)} / ${prob(m.ourAsk)}` : "\u2014"}
                  </td>
                  <td>
                    {full ? (
                      <MiniRail bookBid={m.bookBid!} bookAsk={m.bookAsk!} ourBid={m.ourBid!} ourAsk={m.ourAsk!} />
                    ) : (
                      <span className="tnum" style={{ color: "var(--muted)" }}>
                        &mdash;
                      </span>
                    )}
                  </td>
                  <td className="num tnum">
                    <span className="slack">{m.crossed ? "\u2014" : cents(m.bookSpread)}</span>
                    {m.ourSpread !== undefined && (
                      <>
                        <span style={{ color: "var(--muted)" }}> &rarr; </span>
                        <span className="ours">{cents(m.ourSpread)}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <Status m={m} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Markets() {
  return (
    <section className="section first last">
      <div className="wrap">
        <p className="eyebrow">Live on Somnia testnet</p>
          <h1 className="display">Markets</h1>
          <p className="lede">Every open market, with what the venue quotes and what Ballast quotes.</p>

        <div>
          <Suspense
            fallback={
              <>
                <div style={{ marginTop: 40 }}>
                  <SkeletonStats />
                </div>
                <div style={{ marginTop: 16 }}>
                  <SkeletonPanel height={664} />
                </div>
              </>
            }
          >
            <LiveTable />
          </Suspense>
        </div>

        <EndLine />
      </div>
    </section>
  );
}
