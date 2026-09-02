"use client";

/**
 * Whatever happens at expiry, the pair pays exactly one. Three cases, three
 * sums, all 1.00 — that is why holding both legs carries no risk.
 */
const CASES = [
  { label: "YES resolves", yes: "1.00", no: "0.00" },
  { label: "NO resolves", yes: "0.00", no: "1.00" },
  { label: "Voided", yes: "0.50", no: "0.50" },
];

export default function AlwaysOne() {
  return (
    <div className="dg-cases">
      {CASES.map((c) => (
        <div key={c.label} className="case">
          <div className="case-k mono">{c.label}</div>
          <div className="case-rows">
            <div className="crow">
              <span className="dot yes" />
              YES<span className="push" />
              <span className="mono">{c.yes}</span>
            </div>
            <div className="crow">
              <span className="dot no" />
              NO<span className="push" />
              <span className="mono">{c.no}</span>
            </div>
          </div>
          <div className="case-sum">
            <span>pair pays</span>
            <span className="mono sum">1.00</span>
          </div>
        </div>
      ))}
    </div>
  );
}
