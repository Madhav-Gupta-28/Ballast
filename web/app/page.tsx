import { getMarkets, getVault, fmt, NETWORK, type MarketView } from "@/lib/somnia";
import VaultPanel from "@/components/VaultPanel";
import ConnectButton from "@/components/ConnectButton";
import Mark from "@/components/Mark";
import { HeroRail, MiniRail } from "@/components/SpreadRail";
import SpreadLab, { type LabMarket } from "@/components/SpreadLab";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const NET = "testnet" as const;
const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const HALF_SPREAD = 0.005;

const cents = (p?: number) => (p === undefined ? "—" : `${(p * 100).toFixed(2)}c`);
const prob = (p?: number) => (p === undefined ? "—" : p.toFixed(3));

function countdown(expiry: number): string {
  const s = expiry - Math.floor(Date.now() / 1000);
  if (s <= 0) return "settling";
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`;
}

function Status({ m }: { m: MarketView }) {
  if (m.gap === "empty") return <span className="pill gap">no book</span>;
  if (m.gap === "no-bids") return <span className="pill gap">cannot sell</span>;
  if (m.gap === "no-asks") return <span className="pill gap">cannot buy</span>;
  if (m.ballastIsQuoting) return <span className="pill live">quoting</span>;
  return <span className="pill none">open</span>;
}

export default async function Page() {
  const cfg = NETWORK[NET];

  // An indexer failure and a venue with nothing live look identical if both
  // collapse to an empty array. They are very different things to show.
  let markets: MarketView[] = [];
  let feedError: string | null = null;
  try {
    markets = await getMarkets(NET, HALF_SPREAD, VAULT);
  } catch (e) {
    feedError = (e as Error).message;
  }
  const vault = VAULT ? await getVault(NET, VAULT) : null;

  const quotable = markets.filter(
    (m) => m.bookBid !== undefined && m.bookAsk !== undefined && m.ourBid !== undefined && m.ourAsk !== undefined,
  );
  const mean = (f: (m: MarketView) => number) =>
    quotable.length ? quotable.reduce((a, m) => a + f(m), 0) / quotable.length : 0;

  const meanBook = mean((m) => m.bookSpread!);
  const meanOurs = mean((m) => m.ourSpread!);
  const savedPct = meanBook > 0 ? ((meanBook - meanOurs) / meanBook) * 100 : 0;
  const gaps = markets.filter((m) => m.gap).length;
  const untraded = markets.filter((m) => m.tradeCount === 0).length;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  /* Only the top of book crosses to the client — the lab needs nothing else. */
  const labMarkets: LabMarket[] = quotable.slice(0, 6).map((m) => ({
    symbol: m.symbol,
    asset: m.asset,
    window: m.symbol.replace(m.asset, "").trim(),
    bookBid: m.bookBid!,
    bookAsk: m.bookAsk!,
  }));

  /* The hero rail shows the average market: both bands centred on a common
     mid, so the nesting is the average nesting rather than one cherry-picked
     market. */
  const mid = mean((m) => (m.bookBid! + m.bookAsk!) / 2);
  const rail = {
    bookBid: mid - meanBook / 2,
    bookAsk: mid + meanBook / 2,
    ourBid: mid - meanOurs / 2,
    ourAsk: mid + meanOurs / 2,
  };

  return (
    <>
      <nav className="nav">
        <div className="nav-in">
          <a className="mark" href="/">
            <Mark />
            <b>Ballast</b>
          </a>
          <span className="chip">
            <span className="dot">●</span> Somnia {NET}
          </span>
          <span className="spacer" />
          <ConnectButton />
        </div>
      </nav>

      <div className="wrap">
        <header className="hero">
          <p className="eyebrow plain">Built on Somnia · DreamDEX event contracts</p>
          <h1 className="display">
            Every market needs someone on <em>the other side.</em>
          </h1>
          <p className="lede">
            On DreamDEX, usually nobody is. Ballast is a pooled counterparty that always quotes both
            ways. One unit of collateral mints one YES and one NO, and that pair is worth{" "}
            <strong>exactly one unit at every resolution</strong> — so holding both is riskless, and the
            vault&apos;s only exposure is the imbalance between them.
          </p>

          <div className="instrument">
            <div className="inst-head">
              <span className="t">Spread, live</span>
              <span className="r mono">{stamp}</span>
            </div>
            <div className="inst-body">
              {quotable.length > 0 ? (
                <HeroRail
                  {...rail}
                  caption={`mean of ${quotable.length} live two-sided market${quotable.length === 1 ? "" : "s"}`}
                />
              ) : (
                <p className="panel-empty">
                  {feedError ? `Could not read the venue: ${feedError}` : "No two-sided market open right now."}
                </p>
              )}
              <div className="readout">
                <div className="big mono">{quotable.length ? `${savedPct.toFixed(0)}%` : "—"}</div>
                <p className="cap">
                  tighter than the venue. It quotes <strong className="mono">{cents(meanBook)}</strong> wide;
                  Ballast quotes <strong className="mono">{cents(meanOurs)}</strong>, strictly inside on both
                  sides.
                </p>
                <p className="src">
                  read from the DreamDEX indexer · priced by the same module the quoter posts with · reload
                  to recompute
                </p>
              </div>
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="v">
                {vault ? fmt(vault.nav, cfg.decimals) : "—"}
                <small>{cfg.collateralSymbol}</small>
              </div>
              <div className="k">Vault NAV</div>
            </div>
            <div className="stat">
              <div className="v">{vault ? fmt(vault.sharePrice, 18, 4) : "—"}</div>
              <div className="k">Share price</div>
            </div>
            <div className="stat">
              <div className="v violet">
                {vault ? `${fmt(vault.imbalance, cfg.decimals, 1)}` : "—"}
                <small>/ {vault ? fmt(vault.imbalanceCap, cfg.decimals, 0) : "—"} cap</small>
              </div>
              <div className="k">Imbalance</div>
            </div>
            <div className="stat">
              <div className={`v ${gaps ? "amber" : ""}`}>
                {gaps}
                <small>/ {markets.length} markets</small>
              </div>
              <div className="k">Untradable side</div>
            </div>
          </div>
        </header>

        <section>
          <p className="eyebrow">The venue</p>
          <h2 className="sec">A book nobody is standing in</h2>
          <div className="thesis">
            <div>
              <h3>An order book with nobody in it.</h3>
              <p>
                Across 5,000 settled markets on Somnia mainnet, <b>83.5% never traded at all</b>, and
                lifetime volume is 3,834 USDso. The busiest market in the venue&apos;s history did 100
                trades totalling one cent. A market with no resting orders is not a market — a taker
                cannot be filled at any price.
              </p>
            </div>
            <div>
              <h3 className="hot">A counterparty that never leaves.</h3>
              <p>
                Ballast rests a bid and an ask on every open window, funded by anyone who deposits. It
                cannot be picked off for free: a complete set is worth exactly one unit at every
                resolution, so the vault&apos;s risk is the imbalance between its legs — and that is
                capped in the contract.
              </p>
            </div>
          </div>
        </section>

        <section>
          <p className="eyebrow">Try it</p>
          <h2 className="sec">Choose how tight to quote</h2>
          <p className="sub">
            Drag the half-spread and watch where Ballast would rest inside a real live book. This runs the
            same pricing module the quoter posts with — when it refuses to quote, that is the actual
            refusal, not a mock-up.
          </p>
          <SpreadLab markets={labMarkets} grid={{ tick: cfg.tick, decimals: cfg.decimals }} />
        </section>

        <section>
          <p className="eyebrow">Live markets</p>
          <h2 className="sec">Every open window, and what Ballast does to it</h2>
          <p className="sub">
            The venue&apos;s book as it stands, with the quote Ballast derives for it. A market flagged{" "}
            <em>cannot buy</em> or <em>cannot sell</em> has no resting orders on that side at all.
          </p>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Expires</th>
                  <th className="num">Book</th>
                  <th className="num">Ballast</th>
                  <th>Inside</th>
                  <th className="num">Spread</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {markets.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: feedError ? "var(--amber)" : "var(--muted)" }}>
                      {feedError
                        ? `Could not read the venue: ${feedError}`
                        : "No live markets on this venue right now."}
                    </td>
                  </tr>
                )}
                {markets.map((m) => {
                  const full =
                    m.bookBid !== undefined &&
                    m.bookAsk !== undefined &&
                    m.ourBid !== undefined &&
                    m.ourAsk !== undefined;
                  return (
                    <tr key={m.pool}>
                      <td>
                        <span className="sym">
                          <span className="asset">{m.asset}</span>
                          <span className="win">{m.symbol.replace(m.asset, "").trim()}</span>
                        </span>
                      </td>
                      <td className="tnum" style={{ color: "var(--ink-2)" }}>
                        {countdown(m.expiry)}
                      </td>
                      <td className="num tnum slack">
                        {prob(m.bookBid)} / {prob(m.bookAsk)}
                      </td>
                      <td className="num tnum ours">
                        {m.ourBid !== undefined ? `${prob(m.ourBid)} / ${prob(m.ourAsk)}` : "—"}
                      </td>
                      <td>
                        {full ? (
                          <MiniRail
                            bookBid={m.bookBid!}
                            bookAsk={m.bookAsk!}
                            ourBid={m.ourBid!}
                            ourAsk={m.ourAsk!}
                          />
                        ) : (
                          <span className="tnum" style={{ color: "var(--muted)" }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="num tnum">
                        <span className="slack">{cents(m.bookSpread)}</span>
                        {m.ourSpread !== undefined && (
                          <>
                            <span style={{ color: "var(--muted)" }}> → </span>
                            <span className="ours">{cents(m.ourSpread)}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <Status m={m} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {markets.length > 0 && (
            <p className="note">
              <b>
                {untraded} of these {markets.length} markets {untraded === 1 ? "has" : "have"} never seen a
                single trade.
              </b>{" "}
              That is the venue Ballast is built for — not a liquidity problem to be subsidised, but an
              empty book to be filled by someone whose downside is bounded by arithmetic.
            </p>
          )}
        </section>

        <section>
          <p className="eyebrow">Supply the balance sheet</p>
          <div className="supply">
            <div className="supply-copy">
              <h2 className="sec">Ballast is the trader. You are the capital.</h2>
              <p>
                Deposit {cfg.collateralSymbol} and you own a share of the vault. The quoter posts on your
                behalf, captures the spread it compresses, and your share price moves with it. There is no
                trading interface to learn, because there is nothing for you to trade.
              </p>
              <ul>
                <li>
                  <span className="ix">01</span>
                  <span>
                    <b>Deposit is the whole interaction.</b>
                    Shares round down, so rounding dust always accrues to the pool and never to a depositor.
                  </span>
                </li>
                <li>
                  <span className="ix">02</span>
                  <span>
                    <b>The operator can quote, and nothing else.</b>
                    It cannot withdraw, cannot transfer ownership, and cannot reach the collateral. Proven by
                    test, not by promise.
                  </span>
                </li>
                <li>
                  <span className="ix">03</span>
                  <span>
                    <b>Withdrawals are never trapped.</b>
                    They pay from idle collateral and keep working even while the vault is paused.
                  </span>
                </li>
              </ul>
            </div>
            <VaultPanel vault={VAULT} />
          </div>
        </section>

        <footer>
          <span>
            {vault ? (
              <>
                Vault{" "}
                <a href={`${cfg.explorer}/address/${vault.address}`} target="_blank" rel="noreferrer">
                  {vault.address.slice(0, 10)}…{vault.address.slice(-6)}
                </a>{" "}
                on Somnia {NET}
                {vault.paused && " · PAUSED"}
              </>
            ) : (
              <>Vault not configured — set NEXT_PUBLIC_VAULT_ADDRESS</>
            )}
          </span>
          <span className="spacer" />
          <span>Quotes derived by the same module the quoter posts with.</span>
        </footer>
      </div>
    </>
  );
}
