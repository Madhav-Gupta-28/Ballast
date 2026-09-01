/**
 * Client for the deployed BallastVault.
 *
 * The vault is the trading account, not the operator key. Every write here is a
 * call TO the vault, which then calls the pool. That is what makes the on-chain
 * imbalance cap meaningful — the operator cannot route around it, and cannot
 * move collateral anywhere at all.
 *
 * Reads use viem directly rather than the SDK: none of this is DreamDEX state.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const vaultAbi = parseAbi([
  // reads
  "function nav() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function imbalance() view returns (uint256)",
  "function imbalanceCap() view returns (uint256)",
  "function legTotals() view returns (uint256 yes, uint256 no)",
  "function totalSupply() view returns (uint256)",
  "function paused() view returns (bool)",
  "function operator() view returns (address)",
  "function poolAllowed(address) view returns (bool)",
  // operator writes
  "function mintSet(address pool, uint256 amount)",
  "function burnSet(address pool, uint256 amount)",
  "function placeOrder(address pool, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption) returns (uint256 orderId)",
  "function cancelOrder(address pool, uint128 orderId)",
  "function cancelOrders(address pool, uint128[] orderIds)",
  // owner writes
  "function allowPool(address pool, uint256 yesId, uint256 noId)",
  "function setOperator(address operator)",
  "function setPaused(bool p)",
]);

export interface VaultState {
  nav: bigint;
  sharePrice: bigint;
  imbalance: bigint;
  imbalanceCap: bigint;
  yes: bigint;
  no: bigint;
  totalSupply: bigint;
  paused: boolean;
}

export interface VaultOpts {
  address: Address;
  rpcUrl: string;
  chain: Chain;
  privateKey?: Hex;
  /** Log intended writes and send nothing. */
  dryRun: boolean;
}

export class Vault {
  readonly address: Address;
  readonly dryRun: boolean;
  private readonly pub: PublicClient;
  private readonly wallet?: WalletClient;
  private readonly chain: Chain;
  private readonly account?: ReturnType<typeof privateKeyToAccount>;

  constructor(o: VaultOpts) {
    this.address = o.address;
    this.dryRun = o.dryRun;
    this.chain = o.chain;
    this.pub = createPublicClient({ chain: o.chain, transport: http(o.rpcUrl) }) as PublicClient;
    if (o.privateKey) {
      this.account = privateKeyToAccount(o.privateKey);
      this.wallet = createWalletClient({ account: this.account, chain: o.chain, transport: http(o.rpcUrl) });
    }
  }

  get operatorAddress(): Address | undefined {
    return this.account?.address;
  }

  /* ─────────────────────────────────── reads ─────────────────────────────────── */

  async state(): Promise<VaultState> {
    // viem infers a per-function args tuple, which does not survive a generic
    // wrapper. The cast is confined to this boundary; every call site below is
    // still checked against the ABI by name.
    const call = <T>(functionName: string, args: readonly unknown[] = []) =>
      this.pub.readContract({
        address: this.address,
        abi: vaultAbi,
        functionName,
        args,
      } as never) as Promise<T>;

    const [nav, sharePrice, imbalance, imbalanceCap, legs, totalSupply, paused] = await Promise.all([
      call<bigint>("nav"),
      call<bigint>("sharePrice"),
      call<bigint>("imbalance"),
      call<bigint>("imbalanceCap"),
      call<readonly [bigint, bigint]>("legTotals"),
      call<bigint>("totalSupply"),
      call<boolean>("paused"),
    ]);

    return {
      nav,
      sharePrice,
      imbalance,
      imbalanceCap,
      yes: legs[0],
      no: legs[1],
      totalSupply,
      paused,
    };
  }

  async poolAllowed(pool: Address): Promise<boolean> {
    return this.pub.readContract({
      address: this.address,
      abi: vaultAbi,
      functionName: "poolAllowed",
      args: [pool],
    } as never) as Promise<boolean>;
  }

  /* ────────────────────────────────── writes ─────────────────────────────────── */

  /**
   * Send an operator call.
   *
   * Simulates first. The DreamDEX SDK famously does not — it skips simulation
   * and resolves even on a reverted receipt, so a mint against a Locked market
   * "succeeds" silently. We are not the SDK, so we can just refuse to send a
   * transaction we already know reverts, and surface the reason.
   */
  private async send(functionName: string, args: readonly unknown[], label: string): Promise<Hex | null> {
    if (this.dryRun || !this.wallet || !this.account) {
      console.log(`    [dry-run] ${label}`);
      return null;
    }

    try {
      const { request } = await this.pub.simulateContract({
        address: this.address,
        abi: vaultAbi,
        functionName,
        args,
        account: this.account,
        chain: this.chain,
      } as never);
      const hash = await this.wallet.writeContract(request as never);
      const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
      if (receipt.status === "reverted") {
        throw new Error(`reverted on-chain (${hash})`);
      }
      return hash;
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      throw new Error(`${label}: ${msg}`);
    }
  }

  mintSet(pool: Address, amount: bigint) {
    return this.send("mintSet", [pool, amount], `mintSet(${pool}, ${amount})`);
  }

  burnSet(pool: Address, amount: bigint) {
    return this.send("burnSet", [pool, amount], `burnSet(${pool}, ${amount})`);
  }

  /**
   * @param price     raw units, already a whole multiple of the tick
   * @param quantity  raw units, already a whole multiple of the lot
   * @param expireNs  nanoseconds; mandatory, and capped at the market's expiry
   */
  placeOrder(args: {
    pool: Address;
    isBid: boolean;
    price: bigint;
    quantity: bigint;
    expireNs: bigint;
    orderType?: number;
    selfMatching?: number;
  }) {
    const { pool, isBid, price, quantity, expireNs, orderType = 0, selfMatching = 0 } = args;
    return this.send(
      "placeOrder",
      [pool, isBid, 0n, price, quantity, expireNs, orderType, selfMatching],
      `placeOrder(${isBid ? "bid" : "ask"} ${quantity} @ ${price})`,
    );
  }

  cancelOrders(pool: Address, orderIds: bigint[]) {
    if (orderIds.length === 0) return Promise.resolve(null);
    return this.send("cancelOrders", [pool, orderIds], `cancelOrders(${orderIds.length})`);
  }
}

/** Format a raw amount for logs without pulling in a formatter dependency. */
export function human(raw: bigint, decimals: number, dp = 4): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).slice(0, dp);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
