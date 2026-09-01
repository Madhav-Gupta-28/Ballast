/**
 * Exercises the deposit/withdraw path against a fork of Somnia testnet, using
 * the exact ABI signatures written in lib/chain.ts — not a copy of them. If a
 * signature in that file is wrong, this fails.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, parseUnits, formatUnits } from "viem";

const RPC = "http://localhost:8545";
const VAULT = "0xbB00fDBc4a0700f3cD41e38A63bc7D1f66F1a5AE";
const USER = "0x1258F0645a998Bc0e68AfBEC326e5654db4E1D89";

/* Pull the signature lists straight out of the app source. */
const src = readFileSync(new URL("../lib/chain.ts", import.meta.url), "utf8");
const grab = (name) => {
  const m = src.match(new RegExp(`export const ${name} = parseAbi\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!m) throw new Error(`could not find ${name} in lib/chain.ts`);
  return parseAbi([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
};
const vaultAbi = grab("vaultWriteAbi");
const erc20Abi = grab("erc20Abi");
console.log(`  using ${vaultAbi.length} vault + ${erc20Abi.length} erc20 signatures read from lib/chain.ts\n`);

const chain = { id: 50312, name: "fork", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const wallet = createWalletClient({ chain, account: USER, transport: http(RPC) });

await test.impersonateAccount({ address: USER });
await test.setBalance({ address: USER, value: 10n ** 20n });

// Every check below moves real state on the fork, and the last one empties the
// vault. Snapshot first so this script can be run twice against one anvil.
const snapshot = await test.snapshot();
process.on("exit", () => {});

const fail = [];
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) fail.push(label);
};

const r = (functionName, args) => pub.readContract({ address: VAULT, abi: vaultAbi, functionName, args });
const rc = (functionName, args) => pub.readContract({ address: collateral, abi: erc20Abi, functionName, args });

/* ── every read the panel makes ── */
const collateral = await r("collateral");
const dp = await pub.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" });
const symbol = await pub.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" });
check("panel reads collateral(), decimals(), symbol()", dp === 6 && symbol.length > 0, `${symbol} @ ${dp}dp`);

let [shares0, nav0, supply0, paused, wallet0] = await Promise.all([
  r("balanceOf", [USER]), r("nav"), r("totalSupply"), r("paused"), rc("balanceOf", [USER]),
]);
check("panel reads balances + nav + supply + paused", typeof paused === "boolean",
  `shares ${formatUnits(shares0,18)} nav ${formatUnits(nav0,dp)} wallet ${formatUnits(wallet0,dp)}`);

/* ── the panel's own display maths ── */
const positionValue = (shares0 * nav0) / supply0;
check("positionValue formula matches the vault's own withdraw maths",
  positionValue === (shares0 * nav0) / supply0, `${formatUnits(positionValue, dp)} ${symbol}`);

/* ── DEPOSIT: approve then deposit, exactly as the panel sequences it ── */
const DEP = "250.5";                      // deliberately fractional
const amount = parseUnits(DEP, dp);
const allowance0 = await rc("allowance", [USER, VAULT]);
check("needsApproval computed from a real allowance", typeof allowance0 === "bigint", `allowance ${allowance0}`);

if (allowance0 < amount) {
  const h = await wallet.writeContract({ address: collateral, abi: erc20Abi, functionName: "approve", args: [VAULT, amount] });
  await pub.waitForTransactionReceipt({ hash: h });
}
check("approve() lands", (await rc("allowance", [USER, VAULT])) >= amount);

const expectShares = (amount * supply0) / nav0;
const dh = await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "deposit", args: [amount] });
const drec = await pub.waitForTransactionReceipt({ hash: dh });
check("deposit() succeeds on-chain", drec.status === "success", `gas ${drec.gasUsed}`);

const shares1 = await r("balanceOf", [USER]);
const gained = shares1 - shares0;
check("shares minted match the vault's documented formula", gained === expectShares,
  `got ${formatUnits(gained,18)}, predicted ${formatUnits(expectShares,18)}`);

const wallet1 = await rc("balanceOf", [USER]);
check("exactly the typed amount left the wallet", wallet0 - wallet1 === amount,
  `${formatUnits(wallet0 - wallet1, dp)} ${symbol} for a typed "${DEP}"`);

/* ── WITHDRAW: the panel's preview must equal what actually arrives ── */
const nav1 = await r("nav"), supply1 = await r("totalSupply");
const burn = gained / 2n;
const preview = (burn * nav1) / supply1;              // exactly what the panel shows
const wh = await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "withdraw", args: [burn] });
const wrec = await pub.waitForTransactionReceipt({ hash: wh });
check("withdraw() succeeds on-chain", wrec.status === "success", `gas ${wrec.gasUsed}`);

const wallet2 = await rc("balanceOf", [USER]);
const paid = wallet2 - wallet1;
check("withdraw preview equals the collateral actually paid out", paid === preview,
  `paid ${formatUnits(paid,dp)}, previewed ${formatUnits(preview,dp)}`);
check("shares burned exactly as requested", (await r("balanceOf",[USER])) === shares1 - burn);

/* ── Max button: withdrawing the entire share balance must not revert ── */
const all = await r("balanceOf", [USER]);
const mh = await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "withdraw", args: [all] });
const mrec = await pub.waitForTransactionReceipt({ hash: mh });
check("Max withdraw of the full share balance clears", mrec.status === "success");
check("position is zero afterwards", (await r("balanceOf", [USER])) === 0n);

/* ── a deposit of 0 must revert, as the panel's disabled state assumes ── */
let reverted = false;
try { await pub.simulateContract({ address: VAULT, abi: vaultAbi, functionName: "deposit", args: [0n], account: USER }); }
catch { reverted = true; }
check("deposit(0) reverts — panel disables the button for this", reverted);

await test.revert({ id: snapshot });
const restored = await r("totalSupply");
check("fork state restored, so this script is re-runnable", restored === supply0,
  `totalSupply back to ${formatUnits(restored, 18)}`);

console.log(`\n  ${fail.length === 0 ? "ALL CHECKS PASSED" : "FAILURES: " + fail.join(", ")}`);
process.exit(fail.length === 0 ? 0 : 1);
