"use client";

/**
 * The loop the vault runs, forever.
 *
 * Labels live inside the SVG. Positioning them with CSS percentages meant
 * fighting the viewBox scale factor, and they kept landing on top of their own
 * nodes; in user units the geometry is exact.
 */
const R = 118;

const STEPS = [
  { k: "Quote", d: "both sides, inside the book", x: 0, y: -R, tx: 0, ty: -R - 44, anchor: "middle" },
  { k: "Fill", d: "a taker crosses", x: R, y: 0, tx: R + 34, ty: -6, anchor: "start" },
  { k: "Settle", d: "the window expires", x: 0, y: R, tx: 0, ty: R + 40, anchor: "middle" },
  { k: "Redeem", d: "winners \u2192 collateral", x: -R, y: 0, tx: -R - 34, ty: -6, anchor: "end" },
] as const;

export default function Lifecycle() {
  return (
    <div className="dg-loop" role="img" aria-label="Quote, fill, settle, redeem — repeating">
      <svg viewBox="-312 -196 624 392" className="loop-svg">
        <circle r={R} className="loop-track" />
        <circle r={R} className="loop-run" />

        {STEPS.map((s) => (
          <g key={s.k}>
            <circle cx={s.x} cy={s.y} r="19" className="loop-node" />
            <text x={s.tx} y={s.ty} textAnchor={s.anchor} className="loop-t">
              {s.k}
            </text>
            <text x={s.tx} y={s.ty + 19} textAnchor={s.anchor} className="loop-d">
              {s.d}
            </text>
          </g>
        ))}

        <text x="0" y="-6" textAnchor="middle" className="loop-mk">
          VAULT RISK
        </text>
        <text x="0" y="16" textAnchor="middle" className="loop-mv">
          imbalance only
        </text>

        <circle r="6.5" className="loop-dot">
          <animateMotion
            dur="10s"
            repeatCount="indefinite"
            path={`M ${R} 0 A ${R} ${R} 0 1 1 ${-R} 0 A ${R} ${R} 0 1 1 ${R} 0`}
          />
        </circle>
      </svg>
    </div>
  );
}
