"use client";

import { useState } from "react";

/**
 * The whole primitive in one picture: a unit of collateral becomes a YES and a
 * NO, that pair pays exactly one however the market ends, and so the only thing
 * the vault can actually lose on is the gap between the two legs it holds.
 */
const CASES = [
  { k: "YES wins", yes: 1, no: 0 },
  { k: "NO wins", yes: 0, no: 1 },
  { k: "Voided", yes: 0.5, no: 0.5 },
];

export default function TheSet() {
  const [i, setI] = useState(0);
  const c = CASES[i];

  return (
    <div className="set">
      <div className="set-top">
        <div className="node lg">
          <span className="n-v mono">1.00</span>
          <span className="n-k">collateral</span>
        </div>
        <svg className="fork" viewBox="0 0 110 150" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 75 H42 Q55 75 55 58 V16 Q55 4 68 4 H110" className="wire w-yes" />
          <path d="M0 75 H42 Q55 75 55 92 V134 Q55 146 68 146 H110" className="wire w-no" />
        </svg>
        <div className="stackcol">
          <div className="node yes">
            <span className="n-v mono">{c.yes.toFixed(2)}</span>
            <span className="n-k">YES</span>
          </div>
          <div className="node no">
            <span className="n-v mono">{c.no.toFixed(2)}</span>
            <span className="n-k">NO</span>
          </div>
        </div>
        <div className="set-sum">
          <span className="eq">=</span>
          <div>
            <span className="sum mono">1.00</span>
            <span className="sum-k">always</span>
          </div>
        </div>
      </div>

      <div className="set-ctl">
        <span className="set-ask">However it ends:</span>
        {CASES.map((x, n) => (
          <button key={x.k} className={n === i ? "mchip on" : "mchip"} onClick={() => setI(n)} aria-pressed={n === i}>
            {x.k}
          </button>
        ))}
      </div>

      <p className="set-say">
        The pair is worth one unit in every case — so holding both is riskless.{" "}
        <b>Only the gap between the two legs can lose money, and the contract caps it.</b>
      </p>
    </div>
  );
}
