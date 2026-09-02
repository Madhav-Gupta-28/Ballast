import Link from "next/link";
import type { Metadata } from "next";
import Rise from "@/components/Rise";
import CompleteSet from "@/components/diagrams/CompleteSet";
import AlwaysOne from "@/components/diagrams/AlwaysOne";
import Imbalance from "@/components/diagrams/Imbalance";
import FourSides from "@/components/diagrams/FourSides";
import Lifecycle from "@/components/diagrams/Lifecycle";

export const metadata: Metadata = { title: "How it works — Ballast" };

export default function HowItWorks() {
  return (
    <>
      <section className="section tight">
        <div className="wrap narrow center">
          <Rise>
            <p className="eyebrow">The primitive</p>
            <h1 className="display">
              One collateral. <em>Two outcomes.</em>
            </h1>
            <p className="lede center">
              Everything Ballast does follows from a single piece of arithmetic. Five diagrams, no theory.
            </p>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Step one</p>
              <h2 className="h">A set mints, it never trades</h2>
              <p className="sub center">
                Deposit one unit; the pool returns one YES and one NO. No counterparty, no price.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div className="card pad-lg" style={{ marginTop: 34 }}>
              <CompleteSet />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Step two</p>
              <h2 className="h">
                The pair is <em>always</em> worth one
              </h2>
              <p className="sub center">
                Every way a market can end, the two legs together pay exactly one unit. Holding both is
                riskless — that is the load-bearing fact.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div style={{ marginTop: 34 }}>
              <AlwaysOne />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Step three</p>
              <h2 className="h">Risk is the difference, not the inventory</h2>
              <p className="sub center">
                Matched legs cancel. Only the gap between them is exposure — and the contract caps it. Drag
                the sliders.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div className="card pad-lg" style={{ marginTop: 34 }}>
              <Imbalance />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Step four</p>
              <h2 className="h">Four order kinds, one price axis</h2>
              <p className="sub center">
                Selling YES at a price is buying NO at its complement. Both descriptions land on the same
                point, so one book holds all four sides.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div className="card pad-lg" style={{ marginTop: 34 }}>
              <FourSides />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Step five</p>
              <h2 className="h">The loop the vault runs</h2>
              <p className="sub center">
                Quote both sides, get filled, wait for the window to settle, redeem the winners back into
                collateral. Then again.
              </p>
            </div>
          </Rise>
          <Rise delay={90}>
            <div style={{ marginTop: 46 }}>
              <Lifecycle />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap narrow center">
          <Rise>
            <h2 className="h">That is the whole design.</h2>
            <p className="lede center">
              A counterparty whose downside is bounded by arithmetic rather than by hope.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 30, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn primary" href="/app">
                Supply the vault <span className="arr">→</span>
              </Link>
              <Link className="btn outline" href="/markets">
                See live markets
              </Link>
            </div>
          </Rise>
        </div>
      </section>
    </>
  );
}
