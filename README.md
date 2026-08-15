# ChainBridge Examples

> Two halves of one transaction: an API that charges for a request, and an agent
> that pays for it. Both run against Base Sepolia and produce real transactions.

| | |
|---|---|
| [`paid-api-seller`](paid-api-seller/) | Charges 0.01 USDC per call. Verifies, settles on-chain, serves the resource. |
| [`paid-api-consumer`](paid-api-consumer/) | Provisions a smart account, then pays for a call with one `fetch`. |

Built on [`@chainbridge/pay`](https://github.com/chainbridge-xyz/chainbridge/tree/main/packages/pay)
and [`@chainbridge/wallet`](https://github.com/chainbridge-xyz/chainbridge/tree/main/packages/wallet)
from the [ChainBridge SDK](https://github.com/chainbridge-xyz/chainbridge).
Walkthrough with diagrams: [docs.chainbridge.dev/examples](https://docs.chainbridge.dev/examples).

## Setup

The packages aren't on npm yet, so these resolve them from a local checkout.
Clone both repos **as siblings** — that layout is what the `file:` dependencies
expect:

```bash
git clone https://github.com/chainbridge-xyz/chainbridge.git
git clone https://github.com/chainbridge-xyz/chainbridge-examples.git

cd chainbridge && npm install && npm run build && cd ..   # examples link to dist/
cd chainbridge-examples && npm install
```

Then copy `.env.example` to `.env`:

- `BASE_SEPOLIA_RPC` — any Base Sepolia endpoint
- `PRIVATE_KEY` — throwaway test key, funded with a little ETH and some USDC
- `PIMLICO_API_KEY` — consumer only, and only for `--provision`

USDC comes from [faucet.circle.com](https://faucet.circle.com). The seller pays
gas to submit settlement, so it needs a little ETH too.

## Run them

```bash
set -a && . ./.env && set +a

npm run seller     # terminal 1
npm run consumer   # terminal 2
```

`VERIFY_ONLY=1` on the seller skips on-chain settlement — it still verifies the
signature and serves the resource, which is the right mode when a facilitator or
a batch job settles instead
([ADR-004](https://github.com/chainbridge-xyz/chainbridge/blob/main/docs/adr/004-settlement-model.md)).

`npm run consumer -- --provision` deploys the smart account first. Idempotent,
and the only thing here that needs `PIMLICO_API_KEY`.

### Without funds

```bash
npm run smoke
```

Checks that every symbol the examples import still exists and that the seller
boots and quotes a price — no RPC, no key, no USDC. It's what CI runs. Signing
and settlement still need a real run.

## What a run looks like

```
agent
  smart account  0x4dc738b04445e4fd056A4421276Bf25753fABA52   deployed
  payer EOA      0x8E0747bA08221d3599472696e74665be21dc6dF0
  balances       9.85 USDC · 0.000089 ETH

GET http://localhost:4402/inference
  200 in 1.3s
  resource: "The three-body problem has no general closed-form solution."
  paid 0.01 USDC to 0x4dc738b04445e4fd056A4421276Bf25753fABA52
  settled on-chain, gas 83240

payer USDC 9.85 -> 9.84  (-0.01)
```

## What these exist to show

An agent has **two accounts, with different jobs**.

The **smart account** is its on-chain identity — it batches calls, takes gas
sponsorship, and will hold session keys. Its address is a pure derivation, so it
exists as a name before it exists on-chain.

The **EOA** is the payer. USDC verifies EIP-3009 authorizations with `ecrecover`,
so the signer must be a key; a contract account cannot produce one. That isn't an
SDK limitation, it's how the token works, and it shapes every integration built
on top.

The seller side is four lines in a request handler: `guard.check` returns quote,
reject, or proceed, and the rest of the file is a plain Node HTTP server.

## One caveat

**Balance lags settlement.** Once the transaction is mined and the receipt is in
hand, a standard RPC still serves `balanceOf` at `latest` from a replica seconds
behind — a naive read straight after payment reports no change for a payment that
definitely happened. The consumer polls for this reason.

The receipt is authoritative the moment you have it. The balance is not. Don't
gate anything on a balance read.

## When the SDK changes

These are the first thing that notices a broken public API — they consume the
packages as a customer does, with no workspace resolution to paper over a missing
export. After a change lands in `chainbridge` and its tests pass: rebuild it, run
`npm run smoke`, then run both examples for real. CI does the smoke half on every
push and once a day.

## License

MIT
