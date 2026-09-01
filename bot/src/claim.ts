/**
 * Sweeping settled positions back into collateral.
 *
 * This exists because the kit's `maybeClaim` cannot do it. That path signs from
 * the configured key and redeems *that key's* holdings — but Ballast's outcome
 * tokens are held by the vault contract, so nothing the operator signs will ever
 * reach them.
 *
 * The consequence, seen live: leave the quoter running and NAV drifts down while
 * legTotals reads zero. Nothing is lost — the position settled and its pool
 * rebound to the next window, so the vault stopped counting tokens it still
 * owns. They have to be redeemed explicitly.
 */
import type { Address } from "viem";
import type { EcContext } from "./ec/exchange.js";
import { Vault } from "./vault.js";

interface SettledMarket {
  marketId: string;
  binaryPoolAddress: string;
  yesTokenId: string;
  noTokenId: string;
  winningOutcome: number | null;
  voided: boolean;
}

async function recentlySettled(indexerUrl: string, venueId: string, limit = 40): Promise<SettledMarket[]> {
  const query = `{ Market(
      where: { marketType: {_eq: "BINARY"}, venueId: {_eq: "${venueId}"}, finalized: {_eq: true} }
      order_by: { expiry: desc }, limit: ${limit}
    ) { marketId binaryPoolAddress yesTokenId noTokenId winningOutcome voided } }`;

  const r = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: { Market?: SettledMarket[] } };
  return j.data?.Market ?? [];
}

export interface SweepResult {
  scanned: number;
  redeemed: number;
  errors: string[];
}

/**
 * Redeem every settled position the vault still holds.
 *
 * Only the winning leg is attempted. A losing leg is worth zero, and the vault
 * refuses a redemption that pays nothing — that guard is what stops a passer-by
 * burning live inventory, so it applies here too. Worthless legs are simply left
 * alone; once their pool rebinds they stop being counted at all.
 *
 * A voided market pays both sides half, so both legs are worth redeeming.
 */
export async function sweepRedemptions(ctx: EcContext, vault: Vault, limit = 40): Promise<SweepResult> {
  const out: SweepResult = { scanned: 0, redeemed: 0, errors: [] };
  const venueId = ctx.config.venueId;
  if (!venueId) {
    out.errors.push("VENUE_ID unset — refusing to sweep every venue on the deployment");
    return out;
  }

  const settled = await recentlySettled(ctx.config.indexerUrl, venueId, limit);
  out.scanned = settled.length;

  for (const m of settled) {
    // Which legs are worth anything: the winner, or both if the market voided.
    const legs: { id: bigint; label: string }[] = m.voided
      ? [
          { id: BigInt(m.yesTokenId), label: "YES (void)" },
          { id: BigInt(m.noTokenId), label: "NO (void)" },
        ]
      : m.winningOutcome === 0
        ? [{ id: BigInt(m.yesTokenId), label: "YES" }]
        : m.winningOutcome === 1
          ? [{ id: BigInt(m.noTokenId), label: "NO" }]
          : [];

    for (const leg of legs) {
      let held: bigint;
      try {
        held = await ctx.exchange.client.getOutcomeBalance({
          outcomeToken: ctx.config.addresses.outcomeToken as Address,
          account: vault.address,
          id: leg.id,
        });
      } catch {
        continue;
      }
      if (held === 0n) continue;

      try {
        await vault.redeem(leg.id, held);
        out.redeemed++;
        console.log(`    redeemed ${held} ${leg.label} from ${m.binaryPoolAddress.slice(0, 10)}…`);
      } catch (e) {
        const msg = (e as Error).message;
        // NothingToRedeem is expected on a leg that turned out worthless.
        if (!/NothingToRedeem/i.test(msg)) out.errors.push(`redeem ${leg.label}: ${msg.split("\n")[0]}`);
      }
    }
  }

  return out;
}
