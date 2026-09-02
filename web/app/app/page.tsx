import type { Metadata } from "next";
import { fmt } from "@/lib/somnia";
import { snapshot, cfg, VAULT } from "@/lib/view";
import VaultPanel from "@/components/VaultPanel";
import Rise from "@/components/Rise";

export const metadata: Metadata = { title: "App — Ballast" };
export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function App() {
  const s = await snapshot();

  /* Share price is the vault's return index. It starts at exactly 1.0000 and
     only moves on realised trading, so it is the honest measure of what a
     depositor has earned — per-share cost basis is not tracked on-chain. */
  const priceNum = s.vault ? Number(s.vault.sharePrice) / 1e18 : 1;
  const ret = (priceNum - 1) * 100;
  const imbPct =
    s.vault && Number(s.vault.imbalanceCap) > 0
      ? (Number(s.vault.imbalance) / Number(s.vault.imbalanceCap)) * 100
      : 0;

  return (
    <section className="section tight">
      <div className="wrap">
        <Rise>
          <p className="eyebrow">The vault</p>
          <h1 className="display">Supply the balance sheet</h1>
          <p className="lede">
            Deposit {cfg.collateralSymbol} and you own a share of the vault. The quoter trades it; your
            share price moves with what it captures.
          </p>
        </Rise>

        <Rise delay={80}>
          <div className="stats" style={{ marginTop: 40 }}>
            <div className="stat">
              <div className="v">
                {s.vault ? fmt(s.vault.nav, cfg.decimals) : "—"}
                <small>{cfg.collateralSymbol}</small>
              </div>
              <div className="k">Vault NAV</div>
            </div>
            <div className="stat">
              <div className="v">{s.vault ? fmt(s.vault.sharePrice, 18, 4) : "—"}</div>
              <div className="k">Share price</div>
            </div>
            <div className="stat">
              <div className={`v ${ret >= 0 ? "mint" : "amber"}`}>
                {s.vault ? `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%` : "—"}
              </div>
              <div className="k">Return since inception</div>
            </div>
            <div className="stat">
              <div className="v accent">
                {s.vault ? fmt(s.vault.imbalance, cfg.decimals, 1) : "—"}
                <small>/ {s.vault ? fmt(s.vault.imbalanceCap, cfg.decimals, 0) : "—"}</small>
              </div>
              <div className="k">Imbalance · {imbPct.toFixed(0)}% of cap</div>
            </div>
          </div>
        </Rise>

        <div className="appgrid">
          <Rise delay={120}>
            <VaultPanel vault={VAULT} />
          </Rise>

          <Rise delay={160}>
            <div className="explain">
              <h3 className="h3">What the numbers mean</h3>
              <dl>
                <div>
                  <dt>Share price</dt>
                  <dd>
                    The vault&apos;s return index. It starts at exactly 1.0000 and moves only on realised
                    trading, so it is what a depositor has actually earned per share. Cost basis is not
                    tracked per depositor on-chain, so this is the honest measure rather than an invented
                    one.
                  </dd>
                </div>
                <div>
                  <dt>Imbalance</dt>
                  <dd>
                    The gap between the YES and NO legs the vault holds. Matched legs are riskless; only
                    this gap is exposure, and the contract reverts any order that would push it past the
                    cap.
                  </dd>
                </div>
                <div>
                  <dt>Withdrawals</dt>
                  <dd>
                    Paid from idle collateral, and they keep working even while the vault is paused. If
                    everything is deployed into quotes the operator flattens first — you are never paid out
                    of a position that has not been closed.
                  </dd>
                </div>
                <div>
                  <dt>What the operator can do</dt>
                  <dd>
                    Quote, cancel, and mint or burn sets. It cannot withdraw, cannot transfer ownership,
                    and cannot reach the collateral.
                  </dd>
                </div>
              </dl>
            </div>
          </Rise>
        </div>
      </div>
    </section>
  );
}
