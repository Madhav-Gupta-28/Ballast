"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { somniaTestnet } from "@/lib/chain";

/** Nav-bar wallet control. The panel below does the same job in more detail. */
export default function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const injected = connectors[0];

  if (isConnected && chainId !== somniaTestnet.id) {
    return (
      <button className="btn primary nav-cta" onClick={() => switchChain({ chainId: somniaTestnet.id })}>
        Wrong network
      </button>
    );
  }

  if (isConnected) {
    return (
      <button className="btn ghost" onClick={() => disconnect()} title="Disconnect">
        {address!.slice(0, 6)}…{address!.slice(-4)}
      </button>
    );
  }

  return (
    <button
      className="btn primary nav-cta"
      disabled={isPending || !injected}
      onClick={() => injected && connect({ connector: injected })}
    >
      {isPending ? "Connecting…" : injected ? "Connect wallet" : "No wallet"}
    </button>
  );
}
