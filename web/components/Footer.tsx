import { NETWORK } from "@/lib/somnia";

const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const cfg = NETWORK.testnet;

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <span>Ballast · Somnia testnet</span>
        {VAULT && (
          <a href={`${cfg.explorer}/address/${VAULT}`} target="_blank" rel="noreferrer" className="mono">
            {VAULT.slice(0, 10)}…{VAULT.slice(-6)}
          </a>
        )}
        <span className="push" />
        <span>Quotes derived by the same module the quoter posts with.</span>
      </div>
    </footer>
  );
}
