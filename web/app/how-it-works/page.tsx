import Link from "next/link";
import type { Metadata } from "next";
import Rise from "@/components/Rise";
import TheSet from "@/components/diagrams/TheSet";
import Lifecycle from "@/components/diagrams/Lifecycle";
import EndLine from "@/components/EndLine";

export const metadata: Metadata = { title: "How it works — Ballast" };

export default function HowItWorks() {
  return (
    <>
      <section className="section first">
        <div className="wrap narrow center">
          <Rise>
            <p className="eyebrow">The design</p>
            <h1 className="display">
              Two diagrams. <em>That is the whole thing.</em>
            </h1>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">One</p>
              <h2 className="h">Why Ballast cannot be picked off</h2>
            </div>
          </Rise>
          <Rise delay={90}>
            <div className="card pad-lg" style={{ marginTop: 46 }}>
              <TheSet />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Rise>
            <div className="narrow center">
              <p className="eyebrow dim">Two</p>
              <h2 className="h">What it does, over and over</h2>
            </div>
          </Rise>
          <Rise delay={90}>
            <div style={{ marginTop: 52 }}>
              <Lifecycle />
            </div>
          </Rise>
        </div>
      </section>

      <section className="section last">
        <div className="wrap narrow center">
          <Rise>
            <h2 className="h">
              A counterparty whose downside is <em>arithmetic, not hope.</em>
            </h2>
            <div style={{ display: "flex", gap: 12, marginTop: 34, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn primary" href="/app">
                Supply the vault <span className="arr">→</span>
              </Link>
              <Link className="btn outline" href="/markets">
                See the markets
              </Link>
            </div>
          </Rise>
          <EndLine />
        </div>
      </section>
    </>
  );
}
