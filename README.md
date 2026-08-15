# ChainBridge Examples

> Two halves of one transaction: an API that charges for a request, and an agent
> that pays for it. Both run against Base Sepolia and produce real transactions.

| | |
|---|---|
| [`paid-api-seller`](paid-api-seller/) | Charges 0.01 USDC per call. Verifies the payment, settles it on-chain, serves the resource. |
| [`paid-api-consumer`](paid-api-consumer/) | Provisions a smart account, then pays for a call with one `fetch`. |

Both are built on [`@chainbridge/pay`](https://github.com/chainbridge-xyz/chainbridge/tree/main/packages/pay)
and [`@chainbridge/wallet`](https://github.com/chainbridge-xyz/chainbridge/tree/main/packages/wallet)
from the [ChainBridge SDK](https://github.com/chainbridge-xyz/chainbridge). The
walkthrough version of this page, with diagrams, is at
**[docs.chainbridge.dev/examples](https://docs.chainbridge.dev/examples)**.

| Repo | What's there |
|---|---|
| [`chainbridge`](https://github.com/chainbridge-xyz/chainbridge) | The SDK — packages, contracts, blueprint, decision records. |
| `chainbridge-examples` | This repo. |
| [`chainbridge-docs`](https://github.com/chainbridge-xyz/chainbridge-docs) | The documentation site. |

## Setup

The SDK packages aren't on npm yet, so these examples resolve them from a local
checkout. Clone both repos **as siblings**:

```bash
git clone https://github.com/chainbridge-xyz/chainbridge.git
git clone https://github.com/chainbridge-xyz/chainbridge-examples.git

# build the SDK packages — the examples link to their dist/ output
cd chainbridge && npm install && npm run build && cd ..

cd chainbridge-examples && npm install
```

The layout the `file:` dependencies expect:

```
your-workspace/
├── chainbridge/            # the SDK
└── chainbridge-examples/   # this repo
```

Then copy `.env.example` to `.env` and fill it in. You need:

- `BASE_SEPOLIA_RPC` — any Base Sepolia endpoint
- `PRIVATE_KEY` — a throwaway test key, funded with a little ETH and some USDC
- `PIMLICO_API_KEY` — consumer only, and only for `--provision`

The payer EOA needs USDC on Base Sepolia — get it from
[faucet.circle.com](https://faucet.circle.com). The seller pays gas to submit
settlement, so it needs a little ETH too.

## Run them

```bash
# terminal 1
set -a && . ./.env && set +a
npm run seller

# terminal 2
set -a && . ./.env && set +a
npm run consumer
```

Run the seller with `VERIFY_ONLY=1` to skip on-chain settlement: it will still
verify the signature and serve the resource, which is the right mode if you're
settling through a facilitator or a batch job instead
([ADR-004](https://github.com/chainbridge-xyz/chainbridge/blob/main/docs/adr/004-settlement-model.md)).

Add `--provision` to the agent to deploy its smart account first
(`npm run consumer -- --provision`). It's idempotent, so it's a no-op once
deployed, and it's the only thing here that needs `PIMLICO_API_KEY`.

### Without funds

```bash
npm run smoke
```

Checks that every symbol the examples import still exists and that the seller
boots and quotes a price — no RPC, no key, no USDC. It's what CI runs, and it's
the fast way to find out whether an SDK change broke these examples. Signing and
settlement still need a real run.

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

## The thing these examples exist to show

An agent has **two accounts, with different jobs**, and the consumer example is
the shortest way to see why.

The **smart account** is its on-chain identity — it batches calls, takes
gas sponsorship, and will hold session keys. Its address is a pure derivation,
so it exists as a name before it exists on-chain.

The **EOA** is the payer. USDC verifies EIP-3009 authorizations with
`ecrecover`, so the signer must be a key; a contract account cannot produce one.
That isn't an SDK limitation, it's how the token works, and it shapes every
integration built on top.

The seller side, by contrast, is four lines in a request handler. `guard.check`
returns one of three things — quote a price, reject, or proceed — and the rest
of the file is a plain Node HTTP server.

## One caveat worth knowing

**Balance lags settlement.** After the settlement transaction is mined and the
receipt is in hand, a standard RPC will still serve `balanceOf` at `latest` from
a replica that is seconds behind. A naive read straight after payment reports no
change for a payment that definitely happened — the consumer example polls for
this reason, and says so if it times out.

If you're building a UI: the receipt is authoritative the moment you have it.
The balance is not. Don't gate anything on a balance read.

## When the SDK changes

These examples are the first thing that notices a broken public API. They
consume the packages as a customer does — through `file:` links to the built
`dist/`, with no workspace resolution to paper over a missing export — so an SDK
change that compiles and passes its own tests can still fail here.

So after a change lands in `chainbridge` and its tests pass: rebuild the SDK, run
`npm run smoke` here, then run both examples for real. Fix any drift before
updating [the docs](https://github.com/chainbridge-xyz/chainbridge-docs), so the
documentation describes what these examples actually proved. CI does the smoke
half of that on every push and once a day.

## License

MIT
