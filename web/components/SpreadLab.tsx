"use client";

/**
 * The interactive half of the argument.
 *
 * Pick a live market, drag the half-spread, and watch the quote Ballast would
 * post move inside the venue's book. This runs the *actual* pricing module the
 * quoter posts with — same `reference` and `deriveQuotes`, same integer tick
 * grid — so when it refuses to quote, that is the real refusal, not a mock.
 */
import { useMemo, useState } from "react";
import { reference, deriveQuotes, fromTicks, type Book, type TickGrid } from "@/lib/pricing";
import { HeroRail } from "./SpreadRail";

export interface LabMarket {
  symbol: string;
  asset: string;
  window: string;
  bookBid: number;
  bookAsk: number;
}

const cents = (p: number) => `${(p * 100).toFixed(2)}c`;

export default function SpreadLab({ markets, grid }: { markets: LabMarket[]; grid: TickGrid }) {
  const [i, setI] = useState(0);
  const [halfCents, setHalfCents] = useState(0.5);
  const m = markets[i];

  const result = useMemo(() => {
    if (!m) return null;
    // The reference only ever reads the best level a side, so a book built
    // from the top of book gives exactly the reference the quoter computes.
    const book: Book = { bids: [[m.bookBid, 1]], asks: [[m.bookAsk, 1]] };
    const ref = reference(book, grid);
    const q = deriveQuotes(ref, halfCents / 100, grid);
    if (!q) return { ref, quote: null as null };
    return { ref, quote: { bid: fromTicks(q.bidTicks, grid), ask: fromTicks(q.askTicks, grid) } };
  }, [m, halfCents, grid]);

  if (!m || !result) {
    return (
      <div className="inst">
        <div className="inst-head">
          <span className="t">Try it · a real live market</span>
        </div>
        <div className="inst-body">
          <p className="panel-empty">No two-sided market open to experiment on right now.</p>
        </div>
      </div>
    );
  }

  const bookSpread = m.bookAsk - m.bookBid;
  const q = result.quote;
  const ourSpread = q ? q.ask - q.bid : undefined;
  const saved = q && bookSpread > 0 ? ((bookSpread - ourSpread!) / bookSpread) * 100 : 0;
  /* The clamp shows up as a WIDTH that came back narrower than asked for, not
     as a price outside the book — deriveQuotes pins the quote one tick inside
     rather than letting it rest where it would never trade. Comparing prices
     misses it entirely. */
  const asked = (halfCents * 2) / 100;
  const clamped = q ? ourSpread! < asked - fromTicks(1n, grid) / 2 : false;

  return (
    <div className="inst">
      <div className="inst-head">
        <span className="t">Try it · a real live market</span>
        <div className="chips">
          {markets.map((x, n) => (
            <button
              key={x.symbol}
              className={n === i ? "mchip on" : "mchip"}
              onClick={() => setI(n)}
              aria-pressed={n === i}
            >
              {x.asset} <span>{x.window}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="inst-body">
        <div className="lab-rail">
          {q ? (
            <HeroRail
              bookBid={m.bookBid}
              bookAsk={m.bookAsk}
              ourBid={q.bid}
              ourAsk={q.ask}
              caption={`${m.asset} ${m.window} · read live from the venue`}
            />
          ) : (
            <div className="refusal">
              <b>Ballast declines to quote here.</b>
              <span>The book is already as tight as it can get. Quoting here would not improve it.</span>
            </div>
          )}
        </div>

        <div className="lab-ctl">
          <label className="ctl-row" htmlFor="hs">
            <span className="k">Half-spread</span>
            <span className="v mono">{halfCents.toFixed(2)}c</span>
          </label>
          <input
            id="hs"
            type="range"
            min={0.1}
            max={4}
            step={0.05}
            value={halfCents}
            onChange={(e) => setHalfCents(Number(e.target.value))}
          />
          <p className="ctl-note">
            The quoter runs at <b className="mono">0.50c</b>.
          </p>

          <dl className="lab-out">
            <div>
              <dt>Book</dt>
              <dd className="mono slackt">{cents(bookSpread)}</dd>
            </div>
            <div>
              <dt>Ballast</dt>
              <dd className="mono ourst">{ourSpread !== undefined ? cents(ourSpread) : "—"}</dd>
            </div>
            <div>
              <dt>Tighter by</dt>
              <dd className="mono ourst">{q ? `${saved.toFixed(0)}%` : "—"}</dd>
            </div>
          </dl>

          {q && clamped && (
            <p className="verdict amber">
              Too wide to matter. You asked for {cents(asked)}, but the book is only {cents(bookSpread)} —
              so Ballast pins its quote just inside instead.
            </p>
          )}
          {q && !clamped && (
            <p className="verdict">Inside the book on both sides — a trader here fills against Ballast.</p>
          )}
        </div>
      </div>
    </div>
  );
}
