/**
 * An autonomous agent that provisions a smart account and pays for an API call.
 *
 *   node agent.mjs                 # pay for one inference call
 *   node agent.mjs --provision     # also deploy the smart account first
 *
 * Start the paid-api-seller example in another terminal first.
 *
 * This is the first thing that uses @chainbridge/wallet and @chainbridge/pay
 * together, so it's also where the load-bearing constraint becomes visible:
 * two accounts, with different jobs.
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartWallet } from "@chainbridge/wallet";
import { createPayClient } from "@chainbridge/pay";

const URL_ = process.env.API_URL ?? "http://localhost:4402/inference";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const { PRIVATE_KEY, BASE_SEPOLIA_RPC, PIMLICO_API_KEY } = process.env;
if (!PRIVATE_KEY || !BASE_SEPOLIA_RPC) {
  console.error("Missing PRIVATE_KEY or BASE_SEPOLIA_RPC — see README.md");
  process.exit(1);
}

const owner = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC), account: owner });

// ── The agent's two accounts ────────────────────────────────────────────────
//
// The smart account is the agent's on-chain identity: it batches calls, can be
// gas-sponsored, and will hold session keys. Its address is a pure derivation,
// so it exists as a name before it exists on-chain.
const wallet = createSmartWallet({
  owner,
  chain: baseSepolia,
  publicClient,
  bundlerUrl: `https://api.pimlico.io/v2/base-sepolia/rpc?apikey=${PIMLICO_API_KEY}`,
});

// The EOA is the payer. USDC verifies EIP-3009 authorizations with ecrecover,
// so the signer has to be a key — a contract account cannot sign one. This is
// not a limitation of the SDK; it's how the token works.
const pay = createPayClient({
  account: owner,
  walletClient,
  maxAmount: parseUnits("0.10", 6), // never auto-pay more than 10 cents
});

// ── Preflight ───────────────────────────────────────────────────────────────
const usdc = await publicClient.readContract({
  address: USDC,
  abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf",
  args: [owner.address],
});
const eth = await publicClient.getBalance({ address: owner.address });

console.log("agent");
console.log(`  smart account  ${wallet.address}   ${(await wallet.isDeployed()) ? "deployed" : "counterfactual"}`);
console.log(`  payer EOA      ${owner.address}`);
console.log(`  balances       ${formatUnits(usdc, 6)} USDC · ${formatEther(eth)} ETH`);

if (usdc === 0n) {
  console.error("\nThe payer EOA holds no USDC. Fund it: https://faucet.circle.com (Base Sepolia)");
  process.exit(1);
}

if (process.argv.includes("--provision")) {
  console.log("\nprovisioning smart account…");
  const p = await wallet.provision();
  console.log(p.alreadyDeployed
    ? "  already deployed — no UserOp needed"
    : `  deployed in ${p.transactionHash} (gas ${p.gasUsed}, sponsored: ${p.sponsored})`);
}

// ── Pay for the resource ────────────────────────────────────────────────────
console.log(`\nGET ${URL_}`);
const started = Date.now();

const res = await pay.fetch(URL_);
const body = await res.json();

console.log(`  ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  resource: "${body.resource}"`);

if (res.payment) {
  const { amount, payTo, txHash, gasUsed } = res.payment;
  console.log(`  paid ${formatUnits(BigInt(amount), 6)} USDC to ${payTo}`);
  if (txHash) {
    console.log(`  settled on-chain, gas ${gasUsed}`);
    console.log(`  https://sepolia.basescan.org/tx/${txHash}`);
  } else {
    console.log("  verified but not settled on-chain (server is in VERIFY_ONLY mode)");
  }
}

// Balance lags settlement, by more than you'd expect. The seller waited for its
// own confirmation and the tx is mined, but a standard RPC still serves
// balanceOf at "latest" from a replica that's seconds behind — a naive read here
// reports a zero delta for a payment that definitely happened. Reading at the
// settlement's historical block would be exact, but needs an archive node and
// the free tiers 404 on it. So: poll.
//
// Worth internalising if you're building a UI. The settlement receipt is
// authoritative the moment you have it; the balance is not.
async function balanceOf(address) {
  return publicClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [address],
  });
}

let after = usdc;
for (let i = 0; i < 12 && after === usdc; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  after = await balanceOf(owner.address);
}

console.log(
  after === usdc
    ? `\npayer USDC ${formatUnits(usdc, 6)} — settled, but the RPC hasn't caught up yet (receipt is authoritative)`
    : `\npayer USDC ${formatUnits(usdc, 6)} -> ${formatUnits(after, 6)}  (${formatUnits(after - usdc, 6)})`,
);

if (res.payment && res.payment.payTo.toLowerCase() === wallet.address.toLowerCase()) {
  console.log("\nNote: this demo's seller pays into your own smart account, so the funds");
  console.log("stay recoverable. Set X402_RECIPIENT to a real seller address to change that.");
}
