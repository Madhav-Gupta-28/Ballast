import { NETWORK } from "@/lib/somnia";

const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const cfg = NETWORK.testnet;

/** Replaces the footer: one quiet line at the end of a page. */
export default function EndLine() {
  return (
    <div className="wrap">
      <div className="endline">
        <span>Ballast · Somnia testnet</span>
        {VAULT && (
          <a href={`${cfg.explorer}/address/${VAULT}`} target="_blank" rel="noreferrer" className="mono">
            {VAULT.slice(0, 10)}…{VAULT.slice(-6)}
          </a>
        )}
      </div>
    </div>
  );
}
