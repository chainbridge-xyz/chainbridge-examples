#!/usr/bin/env node
/**
 * Proves the examples still work against the SDK, without funds or a chain.
 *
 *   npm run smoke
 *
 * These examples are the first thing that notices a broken public API — they
 * consume the packages as a customer does, with no workspace resolution to
 * paper over a missing export. That only helps if something actually runs them,
 * and the real run needs a funded key, a live RPC and two terminals. So this
 * checks the part that needs none of it:
 *
 *   1. every symbol the examples import still exists
 *   2. the seller boots and quotes a price — the 402 path, end to end
 *
 * What it deliberately does NOT cover: signing, settlement, and the consumer's
 * paid retry. Those need real USDC. Run the examples by hand for that.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4499;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

/* ── 1 · The imports the examples rely on ────────────────────────────────── */

const EXPECTED = [
  ['@chainbridge/pay', ['createPayClient']],
  ['@chainbridge/pay/server', ['requirePayment', 'selfHostSettlement']],
  ['@chainbridge/wallet', ['createSmartWallet', 'getSmartWalletAddress']],
];

for (const [specifier, names] of EXPECTED) {
  let mod;
  try {
    mod = await import(specifier);
  } catch (err) {
    fail(`${specifier} failed to import — ${err.message.split('\n')[0]}`);
    continue;
  }
  const missing = names.filter((n) => typeof mod[n] !== 'function');
  if (missing.length) fail(`${specifier} no longer exports ${missing.join(', ')}`);
  else console.log(`✓ ${specifier} — ${names.join(', ')}`);
}

if (process.exitCode) {
  console.error('\nThe SDK API drifted. Fix the examples, or the SDK.');
  process.exit(1);
}

/* ── 2 · The seller boots and quotes a price ─────────────────────────────── */

// VERIFY_ONLY keeps settlement off, so nothing here needs a funded account.
// The key is a well-known throwaway and the RPC is never called on this path.
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('../paid-api-seller/', import.meta.url),
  env: {
    ...process.env,
    PORT: String(PORT),
    VERIFY_ONLY: '1',
    BASE_SEPOLIA_RPC: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
    PRIVATE_KEY:
      process.env.PRIVATE_KEY ??
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => (serverOutput += d));
server.stderr.on('data', (d) => (serverOutput += d));

const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

try {
  let quote;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw new Error(`seller exited early:\n${serverOutput}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/inference`);
      if (res.status !== 402) throw new Error(`expected 402 without payment, got ${res.status}`);
      quote = await res.json();
      break;
    } catch (err) {
      if (err.message.startsWith('expected')) throw err;
      await sleep(250);
    }
  }
  if (!quote) throw new Error(`seller never came up:\n${serverOutput}`);

  console.log('✓ seller boots and answers 402 without payment');

  // The quote is the wire format a client has to understand. If its shape moves,
  // every integration breaks, so assert on it rather than just the status code.
  const req = quote.accepts?.[0] ?? quote;
  for (const field of ['payTo', 'asset', 'network', 'maxAmountRequired', 'resource']) {
    if (req[field] === undefined) {
      fail(`the 402 quote is missing "${field}" — payload was ${JSON.stringify(quote)}`);
    }
  }
  if (!process.exitCode) console.log('✓ the 402 quote carries the payment requirements');
} catch (err) {
  fail(err.message);
} finally {
  stop();
}

console.log(process.exitCode ? '\nsmoke test failed' : '\nsmoke test passed');
