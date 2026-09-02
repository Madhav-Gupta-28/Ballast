import type { Metadata } from "next";
import type { MarketView } from "@/lib/somnia";
import { snapshot, cfg, cents, prob, countdown } from "@/lib/view";
import { MiniRail } from "@/components/SpreadRail";
import SpreadLab, { type LabMarket } from "@/components/SpreadLab";
import Rise from "@/components/Rise";

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

export default async function Markets() {
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
      <section className="section tight">
        <div className="wrap">
          <Rise>
            <p className="eyebrow">Live</p>
            <h1 className="display">Every open window</h1>
            <p className="lede">
              The venue&apos;s book as it stands, beside the quote Ballast derives for it. A market marked{" "}
              <strong>cannot buy</strong> or <strong>cannot sell</strong> has no resting orders on that side
              at all.
            </p>
          </Rise>

          <Rise delay={80}>
            <div className="stats" style={{ marginTop: 40 }}>
              <div className="stat">
                <div className="v">{s.markets.length}</div>
                <div className="k">Open windows</div>
              </div>
              <div className="stat">
                <div className="v">{cents(s.meanBook)}</div>
                <div className="k">Mean book spread</div>
              </div>
              <div className="stat">
                <div className="v accent">{cents(s.meanOurs)}</div>
                <div className="k">Ballast quotes</div>
              </div>
              <div className="stat">
                <div className={`v ${s.untraded ? "amber" : ""}`}>
                  {s.untraded}
                  <small>/ {s.markets.length}</small>
                </div>
                <div className="k">Never traded</div>
              </div>
            </div>
          </Rise>

          <Rise delay={120}>
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
                          {m.ourBid !== undefined ? `${prob(m.ourBid)} / ${prob(m.ourAsk)}` : "—"}
                        </td>
                        <td>
                          {full ? (
                            <MiniRail
                              bookBid={m.bookBid!}
                              bookAsk={m.bookAsk!}
                              ourBid={m.ourBid!}
                              ourAsk={m.ourAsk!}
                            />
                          ) : (
                            <span className="tnum" style={{ color: "var(--muted)" }}>
                              —
                            </span>
                          )}
                        </td>
                        <td className="num tnum">
                          <span className="slack">{m.crossed ? "—" : cents(m.bookSpread)}</span>
                          {m.ourSpread !== undefined && (
                            <>
                              <span style={{ color: "var(--muted)" }}> → </span>
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
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Try it</p>
              <h2 className="h">Choose how tight to quote</h2>
              <p className="sub center">
                Drag the half-spread against a real live book. This runs the same pricing module the quoter
                posts with — when it refuses, that is the actual refusal.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div style={{ marginTop: 34 }}>
              <SpreadLab markets={lab} grid={{ tick: cfg.tick, decimals: cfg.decimals }} />
            </div>
          </Rise>
        </div>
      </section>
    </>
  );
}
