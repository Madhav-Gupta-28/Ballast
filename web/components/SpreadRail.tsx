"use client";

/**
 * The spread, drawn as what it actually is: a toll.
 *
 * The previous version showed two nested bands and four bare probabilities and
 * expected the reader to infer the point. Now the wide grey bar is labelled
 * with what a trader pays, the violet bar animates inward to what Ballast
 * charges instead, and the raw prices sit underneath as detail rather than as
 * the headline.
 */
import { useEffect, useRef, useState } from "react";

export interface RailProps {
  bookBid: number;
  bookAsk: number;
  ourBid: number;
  ourAsk: number;
}

const cents = (p: number) => `${(p * 100).toFixed(2)}c`;

export function MiniRail(p: RailProps) {
  const pad = Math.max((p.bookAsk - p.bookBid) * 0.5, 0.004);
  const lo = p.bookBid - pad;
  const hi = p.bookAsk + pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="minirail" aria-hidden="true">
      <span className="base" />
      <span className="v" style={{ left: `${x(p.bookBid)}%`, right: `${100 - x(p.bookAsk)}%` }} />
      <span className="o" style={{ left: `${x(p.ourBid)}%`, right: `${100 - x(p.ourAsk)}%` }} />
    </div>
  );
}

export function HeroRail({ bookBid, bookAsk, ourBid, ourAsk, caption }: RailProps & { caption?: string }) {
  const bookW = bookAsk - bookBid;
  const ourW = ourAsk - ourBid;
  const saved = bookW > 0 ? ((bookW - ourW) / bookW) * 100 : 0;

  /* The violet bar starts as wide as the venue's and eases in to its real
     width, so the compression is something you watch happen. */
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setRun(true),
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => {
      setRun(false);
      setTimeout(() => setRun(true), 90);
    }, 5200);
    return () => clearInterval(t);
  }, [run]);

  const oursPct = bookW > 0 ? (ourW / bookW) * 100 : 100;

  return (
    <div className="toll" ref={ref}>
      <div className="toll-row">
        <span className="toll-k">The venue charges</span>
        <div className="toll-track">
          <span className="toll-bar venue" />
        </div>
        <span className="toll-v mono">{cents(bookW)}</span>
      </div>

      <div className="toll-row">
        <span className="toll-k accent">Ballast charges</span>
        <div className="toll-track">
          <span
            className="toll-bar ours"
            style={{ width: run ? `${oursPct}%` : "100%" }}
          />
        </div>
        <span className="toll-v mono accent">{cents(ourW)}</span>
      </div>

      <p className="toll-say">
        That gap is the toll you pay to get in or out of a trade.{" "}
        <b>Ballast makes it {saved.toFixed(0)}% smaller.</b>
      </p>

      <div className="toll-detail">
        <span>
          highest anyone will pay <b className="mono">{bookBid.toFixed(3)}</b>
        </span>
        <span>
          lowest anyone will sell <b className="mono">{bookAsk.toFixed(3)}</b>
        </span>
        <span className="push" />
        <span className="dim">a price is the chance of YES, from 0 to 1</span>
      </div>
      {caption && <p className="toll-cap">{caption}</p>}
    </div>
  );
}
