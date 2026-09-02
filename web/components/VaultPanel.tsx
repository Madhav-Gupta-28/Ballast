"use client";

/**
 * Deposit and withdraw, straight against the vault.
 *
 * Shares are always 18dp (the contract scales collateral up to that basis), so
 * nothing here branches on network decimals except the collateral leg, which is
 * read live off the token rather than assumed.
 */
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { erc20Abi, somniaTestnet, vaultWriteAbi } from "@/lib/chain";

const EXPLORER = "https://shannon-explorer.somnia.network";
const SHARE_DP = 18;

/** Trim a formatted amount for display without ever rounding it up. */
function show(raw: bigint | undefined, dp: number, places = 4): string {
  if (raw === undefined) return "—";
  const s = formatUnits(raw, dp);
  const [w, f = ""] = s.split(".");
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return places > 0 ? `${whole}.${f.padEnd(places, "0").slice(0, places)}` : whole;
}

/** Contract errors are readable; RPC noise is not. Surface the useful half. */
function reason(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/User rejected|denied transaction/i.test(m)) return "Rejected in wallet.";
  if (/Paused/.test(m)) return "Deposits are paused.";
  if (/ZeroAmount/.test(m)) return "Amount rounds to zero.";
  if (/transfer amount exceeds balance|ERC20: transfer/i.test(m))
    return "Not enough collateral in the vault to pay that out yet — the operator flattens quotes first.";
  if (/insufficient funds/i.test(m)) return "Not enough STT for gas.";
  const short = m.split("\n")[0];
  return short.length > 140 ? short.slice(0, 140) + "…" : short;
}

export default function VaultPanel({ vault }: { vault: string }) {
  const vaultAddress = vault as Address;
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== somniaTestnet.id;
  const enabled = Boolean(vaultAddress) && !wrongChain;

  /* ── the collateral token, read rather than assumed ── */
  const { data: collateral } = useReadContract({
    address: vaultAddress,
    abi: vaultWriteAbi,
    functionName: "collateral",
    query: { enabled },
  });

  const { data: tokenMeta } = useReadContracts({
    contracts: [
      { address: collateral, abi: erc20Abi, functionName: "decimals" },
      { address: collateral, abi: erc20Abi, functionName: "symbol" },
    ],
    query: { enabled: Boolean(collateral) },
  });
  const dp = (tokenMeta?.[0]?.result as number | undefined) ?? 6;
  const symbol = (tokenMeta?.[1]?.result as string | undefined) ?? "tUSDC";

  /* ── balances and vault state ── */
  const { data: reads, refetch } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: vaultWriteAbi, functionName: "balanceOf", args: [address!] },
      { address: vaultAddress, abi: vaultWriteAbi, functionName: "nav" },
      { address: vaultAddress, abi: vaultWriteAbi, functionName: "totalSupply" },
      { address: vaultAddress, abi: vaultWriteAbi, functionName: "paused" },
      { address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: collateral, abi: erc20Abi, functionName: "allowance", args: [address!, vaultAddress] },
    ],
    query: { enabled: enabled && Boolean(address) && Boolean(collateral), refetchInterval: 8000 },
  });

  const shares = reads?.[0]?.result as bigint | undefined;
  const nav = reads?.[1]?.result as bigint | undefined;
  const supply = reads?.[2]?.result as bigint | undefined;
  const paused = reads?.[3]?.result as boolean | undefined;
  const walletBal = reads?.[4]?.result as bigint | undefined;
  const allowance = reads?.[5]?.result as bigint | undefined;

  /** What the connected wallet's shares are worth, by the same maths the vault uses. */
  const positionValue = useMemo(() => {
    if (shares === undefined || nav === undefined || !supply) return undefined;
    return (shares * nav) / supply;
  }, [shares, nav, supply]);

  /* ── parse the input exactly; never through a float ── */
  const parsed = useMemo(() => {
    const t = amount.trim();
    if (!t) return null;
    try {
      const v = parseUnits(t, tab === "deposit" ? dp : SHARE_DP);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, tab, dp]);

  /** Withdrawing burns shares; show what they pay out before it is irreversible. */
  const withdrawPreview = useMemo(() => {
    if (tab !== "withdraw" || !parsed || nav === undefined || !supply) return undefined;
    return (parsed * nav) / supply;
  }, [tab, parsed, nav, supply]);

  const needsApproval = tab === "deposit" && parsed !== null && (allowance ?? 0n) < parsed;
  const overBalance =
    parsed !== null &&
    (tab === "deposit" ? parsed > (walletBal ?? 0n) : parsed > (shares ?? 0n));

  const { writeContractAsync, isPending: signing } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (mined) {
      setAmount("");
      refetch();
    }
  }, [mined, refetch]);

  async function run(kind: "approve" | "deposit" | "withdraw") {
    setErr(null);
    if (!parsed) return;
    try {
      const h =
        kind === "approve"
          ? await writeContractAsync({
              address: collateral!,
              abi: erc20Abi,
              functionName: "approve",
              args: [vaultAddress, parsed],
            })
          : kind === "deposit"
            ? await writeContractAsync({
                address: vaultAddress,
                abi: vaultWriteAbi,
                functionName: "deposit",
                args: [parsed],
              })
            : await writeContractAsync({
                address: vaultAddress,
                abi: vaultWriteAbi,
                functionName: "withdraw",
                args: [parsed],
              });
      setHash(h);
    } catch (e) {
      setErr(reason(e));
    }
  }

  const busy = signing || mining;

  /* ── states before the form is usable ── */
  if (!vaultAddress) {
    return (
      <div className="panel">
        <div className="panel-h">Your position</div>
        <div className="panel-b">
          <p className="panel-empty">Vault not configured — set NEXT_PUBLIC_VAULT_ADDRESS.</p>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <div className="panel">
        <div className="panel-h">Your position</div>
        <div className="panel-b">
          <p className="panel-empty">
            Connect a wallet to deposit {symbol}. Your shares earn the spread the quoter captures.
          </p>
          <button
            className="btn primary"
            disabled={connecting || !injectedConnector}
            onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          >
            {connecting ? "Connecting…" : injectedConnector ? "Connect wallet" : "No wallet detected"}
          </button>
        </div>
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="panel">
        <div className="panel-h">Your position</div>
        <div className="panel-b">
          <p className="panel-empty">This vault lives on Somnia Testnet.</p>
          <button className="btn primary" onClick={() => switchChain({ chainId: somniaTestnet.id })}>
            Switch to Somnia Testnet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-h">
        Your position
        <button className="linkish" onClick={() => disconnect()}>
          {address!.slice(0, 6)}…{address!.slice(-4)} · disconnect
        </button>
      </div>

      <div className="panel-b">
      <div className="posrow">
        <div>
          <div className="k">Shares held</div>
          <div className="v mono">{show(shares, SHARE_DP, 4)}</div>
        </div>
        <div>
          <div className="k">Worth · <span className="sym-cased">{symbol}</span></div>
          <div className="v mono violet">{show(positionValue, dp, 2)}</div>
        </div>
        <div>
          <div className="k">In wallet · <span className="sym-cased">{symbol}</span></div>
          <div className="v mono">{show(walletBal, dp, 2)}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "tab on" : "tab"}
            onClick={() => {
              setTab(t);
              setAmount("");
              setErr(null);
            }}
          >
            {t === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>

      <div className="field">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setErr(null);
          }}
          aria-label={tab === "deposit" ? `Amount of ${symbol} to deposit` : "Shares to withdraw"}
        />
        <span className="suffix">{tab === "deposit" ? symbol : "shares"}</span>
        <button
          className="btn ghost"
          onClick={() =>
            setAmount(
              tab === "deposit"
                ? formatUnits(walletBal ?? 0n, dp)
                : formatUnits(shares ?? 0n, SHARE_DP),
            )
          }
        >
          Max
        </button>
      </div>

      {tab === "withdraw" && withdrawPreview !== undefined && (
        <p className="hint">
          Pays out ≈ <span className="mono sea">{show(withdrawPreview, dp, 2)}</span> {symbol}
        </p>
      )}
      {tab === "deposit" && paused && <p className="hint warn">Deposits are paused. Withdrawals still work.</p>}
      {overBalance && <p className="hint warn">More than you hold.</p>}
      {err && <p className="hint warn">{err}</p>}
      {mined && hash && (
        <p className="hint">
          Confirmed ·{" "}
          <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
            view transaction
          </a>
        </p>
      )}

      {tab === "deposit" ? (
        needsApproval ? (
          <button className="btn primary" disabled={!parsed || overBalance || busy} onClick={() => run("approve")}>
            {busy ? "Approving…" : `Approve ${symbol}`}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!parsed || overBalance || busy || paused}
            onClick={() => run("deposit")}
          >
            {busy ? "Depositing…" : "Deposit"}
          </button>
        )
      ) : (
        <button className="btn primary" disabled={!parsed || overBalance || busy} onClick={() => run("withdraw")}>
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      )}

      <p className="fine">
        Withdrawals pay from idle collateral. If the vault is fully deployed into quotes, the operator
        flattens first — depositors are never paid out of an unclosed position.
      </p>
      </div>
    </div>
  );
}
