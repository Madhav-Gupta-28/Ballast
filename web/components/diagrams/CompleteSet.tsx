"use client";

/** 1 collateral in, one YES and one NO out. The split is the whole primitive. */
export default function CompleteSet() {
  return (
    <div className="dg dg-split">
      <div className="node lg">
        <span className="n-v mono">1.00</span>
        <span className="n-k">collateral</span>
      </div>

      <svg className="fork" viewBox="0 0 120 160" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 80 H46 Q60 80 60 62 V16 Q60 4 74 4 H120" className="wire w-yes" />
        <path d="M0 80 H46 Q60 80 60 98 V144 Q60 156 74 156 H120" className="wire w-no" />
      </svg>

      <div className="stackcol">
        <div className="node yes">
          <span className="n-v mono">1.00</span>
          <span className="n-k">YES</span>
        </div>
        <div className="node no">
          <span className="n-v mono">1.00</span>
          <span className="n-k">NO</span>
        </div>
      </div>
    </div>
  );
}
