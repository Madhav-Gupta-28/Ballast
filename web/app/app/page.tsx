import type { Metadata } from "next";
import { fmt } from "@/lib/somnia";
import { snapshot, cfg, VAULT } from "@/lib/view";
import VaultPanel from "@/components/VaultPanel";
import EndLine from "@/components/EndLine";
import { Suspense } from "react";
import Rise from "@/components/Rise";
import { SkeletonStats } from "@/components/Skeleton";

export const metadata: Metadata = { title: "App — Ballast" };
export const revalidate = 0;
export const dynamic = "force-dynamic";

/** Only the four numbers need the chain; the panel reads it client-side. */
async function VaultStats() {
  const s = await snapshot();
  const priceNum = s.vault ? Number(s.vault.sharePrice) / 1e18 : 1;
  const ret = (priceNum - 1) * 100;

  return (
    <div className="stats" style={{ marginTop: 48 }}>
      <div className="stat">
        <div className="v">
          {s.vault ? fmt(s.vault.nav, cfg.decimals) : "—"}
          <small>{cfg.collateralSymbol}</small>
        </div>
        <div className="k">In the vault</div>
      </div>
      <div className="stat">
        <div className="v">{s.vault ? fmt(s.vault.sharePrice, 18, 4) : "—"}</div>
        <div className="k">Price per share</div>
      </div>
      <div className="stat">
        <div className={`v ${ret >= 0 ? "mint" : "amber"}`}>
          {s.vault ? `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%` : "—"}
        </div>
        <div className="k">Return so far</div>
      </div>
      <div className="stat">
        <div className="v accent">
          {s.vault ? fmt(s.vault.imbalance, cfg.decimals, 1) : "—"}
          <small>/ {s.vault ? fmt(s.vault.imbalanceCap, cfg.decimals, 0) : "—"}</small>
        </div>
        <div className="k">Risk vs its cap</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <section className="section first last">
      <div className="wrap">
        <p className="eyebrow">Somnia testnet</p>
          <h1 className="display">Deposit</h1>
          <p className="lede">Fund the vault and own a share of what it makes.</p>

        <div>
          <Suspense
            fallback={
              <div style={{ marginTop: 48 }}>
                <SkeletonStats />
              </div>
            }
          >
            <VaultStats />
          </Suspense>
        </div>

        <Rise delay={110}>
          <div className="panelwrap">
            <VaultPanel vault={VAULT} />
          </div>
        </Rise>

        <Rise delay={150}>
          <dl className="defs">
            <div>
              <dt>Price per share</dt>
              <dd>Started at 1.0000. Where it is now is what the vault has earned.</dd>
            </div>
            <div>
              <dt>Risk vs its cap</dt>
              <dd>How lopsided its positions are. The contract refuses to go past the cap.</dd>
            </div>
            <div>
              <dt>Withdrawing</dt>
              <dd>Paid from cash on hand, and it keeps working even if the vault is paused.</dd>
            </div>
            <div>
              <dt>The operator</dt>
              <dd>Can place and cancel quotes. It can never touch your money.</dd>
            </div>
          </dl>
        </Rise>

        <EndLine />
      </div>
    </section>
  );
}
