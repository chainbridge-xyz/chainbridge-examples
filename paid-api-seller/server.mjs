/**
 * A paid API — charges USDC per request using @chainbridge/pay.
 *
 *   node server.mjs
 *
 * The whole integration is the `guard` below plus four lines in the handler.
 * Everything else in this file is a plain Node HTTP server.
 */

import { createServer } from "node:http";
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { requirePayment, selfHostSettlement } from "@chainbridge/pay/server";

const PORT = Number(process.env.PORT ?? 4402);
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle, Base Sepolia
const PRICE = parseUnits("0.01", 6); // 0.01 USDC per call

const { PRIVATE_KEY, BASE_SEPOLIA_RPC, X402_RECIPIENT } = process.env;
if (!PRIVATE_KEY || !BASE_SEPOLIA_RPC) {
  console.error("Missing PRIVATE_KEY or BASE_SEPOLIA_RPC — see README.md");
  process.exit(1);
}

// The account that SUBMITS settlement and pays its gas. Separate from `payTo`,
// which is where the money lands — they don't have to be the same address, and
// in the facilitator model (ADR-004) they won't be.
const submitter = privateKeyToAccount(PRIVATE_KEY);
const payTo = X402_RECIPIENT ?? submitter.address;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC), account: submitter });

// Settlement is opt-out: without it the server verifies the signature and
// serves the resource, leaving the funds to be moved elsewhere (a facilitator,
// a batch job). With it, the seller submits transferWithAuthorization itself
// and pays the gas — ADR-004 Option A.
const settling = process.env.VERIFY_ONLY !== "1";

const guard = requirePayment({
  payTo,
  asset: USDC,
  network: "base-sepolia",
  chainId: baseSepolia.id,
  amount: PRICE.toString(),
  tokenDomain: { name: "USDC", version: "2" },
  resource: `http://localhost:${PORT}/inference`,
  description: "One inference call",
  maxTimeoutSeconds: 300,
  ...(settling
    ? { settle: selfHostSettlement({ walletClient, publicClient, account: submitter, asset: USDC }) }
    : {}),
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/inference")) {
    res.writeHead(404).end("not found");
    return;
  }

  // ── the entire payment integration ──────────────────────────────────────
  const result = await guard.check(req.headers["x-payment"]);
  if (result.kind !== "ok") {
    console.log(`  ${result.kind === "reject" ? `rejected: ${result.reason}` : "402 — quoting price"}`);
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
    return;
  }
  // ── paid; deliver the resource ──────────────────────────────────────────

  const { receipt } = result;
  console.log(`  paid ${formatUnits(BigInt(receipt.amount), 6)} USDC` +
    (receipt.txHash ? ` — settled ${receipt.txHash} (gas ${receipt.gasUsed})` : " — verified, not settled"));

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    resource: "The three-body problem has no general closed-form solution.",
    settlementTxHash: receipt.txHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  }));
});

server.listen(PORT, () => {
  console.log(`paid-api-seller listening on http://localhost:${PORT}/inference`);
  console.log(`  price      ${formatUnits(PRICE, 6)} USDC per call`);
  console.log(`  payTo      ${payTo}`);
  console.log(`  settlement ${settling ? `on — ${submitter.address} submits and pays gas` : "off (VERIFY_ONLY=1)"}`);
});
