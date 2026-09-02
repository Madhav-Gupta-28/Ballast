"use client";

import { useState } from "react";

/**
 * Gross inventory is not the risk. Matched legs cancel to a riskless pair; only
 * the difference between them is exposure. Drag it and watch the number move.
 */
export default function Imbalance() {
  const [yes, setYes] = useState(140);
  const [no, setNo] = useState(100);

  const matched = Math.min(yes, no);
  const gap = Math.abs(yes - no);
  const max = Math.max(yes, no, 1);
  const pw = (v: number) => `${(v / max) * 100}%`;

  return (
    <div className="dg-imb">
      <div className="imb-bars">
        <div className="ibar">
          <span className="ib-k mono">YES held</span>
          <div className="track">
            <span className="fill matched" style={{ width: pw(matched) }} />
            {yes > no && <span className="fill excess" style={{ left: pw(matched), width: pw(gap) }} />}
          </div>
          <span className="ib-v mono">{yes}</span>
        </div>
        <div className="ibar">
          <span className="ib-k mono">NO held</span>
          <div className="track">
            <span className="fill matched" style={{ width: pw(matched) }} />
            {no > yes && <span className="fill excess" style={{ left: pw(matched), width: pw(gap) }} />}
          </div>
          <span className="ib-v mono">{no}</span>
        </div>
      </div>

      <div className="imb-legend">
        <span>
          <i className="sw matched" /> {matched} matched — riskless, worth exactly {matched}.00 at every
          resolution
        </span>
        <span>
          <i className="sw excess" /> {gap} unmatched — <b>this alone is the exposure</b>
        </span>
      </div>

      <div className="imb-ctl">
        <label>
          <span className="mono">YES</span>
          <input type="range" min={0} max={200} value={yes} onChange={(e) => setYes(+e.target.value)} />
        </label>
        <label>
          <span className="mono">NO</span>
          <input type="range" min={0} max={200} value={no} onChange={(e) => setNo(+e.target.value)} />
        </label>
        <div className="imb-out">
          <span className="k mono">Imbalance</span>
          <span className={`v mono ${gap > 50 ? "over" : ""}`}>{gap}</span>
          <span className="cap mono">cap 50</span>
        </div>
      </div>
      {gap > 50 && (
        <p className="imb-warn">
          Over the cap. The contract refuses the order that would take it here — not a guideline, a revert.
        </p>
      )}
    </div>
  );
}
