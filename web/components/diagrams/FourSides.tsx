"use client";

import { useState } from "react";

/**
 * A binary book has four order kinds but only one price axis. Selling YES at p
 * is buying NO at 1 - p. Toggle and watch both descriptions land on the same
 * point — which is why the front end can fold NO orders in at their complement.
 */
export default function FourSides() {
  const [p, setP] = useState(0.62);
  const x = `${p * 100}%`;

  return (
    <div className="dg-four">
      <div className="four-axis">
        <span className="ax-line" />
        <span className="ax-tick" style={{ left: x }} />
        <span className="ax-tick ghost" style={{ left: `${(1 - p) * 100}%` }} />
        <span className="ax-lab l">0.000</span>
        <span className="ax-lab r">1.000</span>
        <span className="ax-val mono" style={{ left: x }}>
          {p.toFixed(3)}
        </span>
        <span className="ax-val ghost mono" style={{ left: `${(1 - p) * 100}%` }}>
          {(1 - p).toFixed(3)}
        </span>
      </div>

      <input
        className="four-range"
        type="range"
        min={0.02}
        max={0.98}
        step={0.005}
        value={p}
        onChange={(e) => setP(+e.target.value)}
        aria-label="YES price"
      />

      <div className="four-pairs">
        <div className="fp">
          <span className="fp-k mono">SELL YES</span>
          <span className="fp-v mono">@ {p.toFixed(3)}</span>
        </div>
        <span className="fp-eq">is the same trade as</span>
        <div className="fp ghost">
          <span className="fp-k mono">BUY NO</span>
          <span className="fp-v mono">@ {(1 - p).toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
