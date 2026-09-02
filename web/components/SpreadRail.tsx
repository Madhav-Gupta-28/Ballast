/**
 * The one picture this whole project is about: the venue's book is slack and
 * wide, and Ballast's quote sits strictly inside it.
 *
 * Both bands are drawn on a shared domain, so "inside" is something you can
 * see rather than a claim in a caption. The same component runs at hero scale
 * and, stripped down, once per table row.
 */

export interface RailProps {
  /** Book bid/ask and Ballast bid/ask, as probabilities on the same axis. */
  bookBid: number;
  bookAsk: number;
  ourBid: number;
  ourAsk: number;
}

/** Pad the domain out from the wider band so it never touches the ends. */
function domain({ bookBid, bookAsk }: RailProps) {
  const pad = Math.max((bookAsk - bookBid) * 0.55, 0.004);
  return { lo: bookBid - pad, hi: bookAsk + pad };
}
const pct = (v: number, lo: number, hi: number) => ((v - lo) / (hi - lo)) * 100;
const cents = (p: number) => `${(p * 100).toFixed(2)}c`;

export function MiniRail(p: RailProps) {
  const { lo, hi } = domain(p);
  const x = (v: number) => pct(v, lo, hi);
  return (
    <div className="minirail" aria-hidden="true">
      <span className="base" />
      <span className="v" style={{ left: `${x(p.bookBid)}%`, right: `${100 - x(p.bookAsk)}%` }} />
      <span className="o" style={{ left: `${x(p.ourBid)}%`, right: `${100 - x(p.ourAsk)}%` }} />
    </div>
  );
}

export function HeroRail(p: RailProps & { caption?: string }) {
  const { lo, hi } = domain(p);
  const x = (v: number) => pct(v, lo, hi);
  const bookW = cents(p.bookAsk - p.bookBid);
  const ourW = cents(p.ourAsk - p.ourBid);

  return (
    <div className="rail">
      <div className="rail-axis">
        <span className="edge" style={{ left: `${x(p.bookBid)}%` }} />
        <span className="edge" style={{ left: `${x(p.bookAsk)}%` }} />
        <span className="edge ours" style={{ left: `${x(p.ourBid)}%` }} />
        <span className="edge ours" style={{ left: `${x(p.ourAsk)}%` }} />
        <span className="rail-base" />

        <span className="caplabel v" style={{ left: `${x(p.bookBid)}%`, transform: "translateX(-50%)" }}>
          {p.bookBid.toFixed(3)}
        </span>
        <span className="caplabel v" style={{ left: `${x(p.bookAsk)}%`, transform: "translateX(-50%)" }}>
          {p.bookAsk.toFixed(3)}
        </span>
        <span className="band venue" style={{ left: `${x(p.bookBid)}%`, right: `${100 - x(p.bookAsk)}%` }} />
        <span className="band ours" style={{ left: `${x(p.ourBid)}%`, right: `${100 - x(p.ourAsk)}%` }} />
        <span className="caplabel o" style={{ left: `${x(p.ourBid)}%`, transform: "translateX(-50%)" }}>
          {p.ourBid.toFixed(3)}
        </span>
        <span className="caplabel o" style={{ left: `${x(p.ourAsk)}%`, transform: "translateX(-50%)" }}>
          {p.ourAsk.toFixed(3)}
        </span>
      </div>

      <div className="rail-key">
        <span className="keyitem">
          <i style={{ background: "var(--slack)" }} />
          The venue&apos;s book <span className="n mono">{bookW}</span>
        </span>
        <span className="keyitem">
          <i style={{ background: "var(--violet)" }} />
          Ballast, resting inside it <span className="n mono">{ourW}</span>
        </span>
        {p.caption && <span className="keyitem n">{p.caption}</span>}
      </div>
    </div>
  );
}
