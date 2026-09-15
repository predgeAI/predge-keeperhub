/**
 * The integration, end to end — the agent that closes the loop.
 *
 *   Predge (verified signal)  ->  gate  ->  KeeperHub (deterministic execution)
 *
 * 1. Fetch a signed conviction signal from Predge.
 * 2. Verify the ed25519 signature OFFLINE against Predge's pinned key. A
 *    probabilistic agent never acts on data it cannot prove — flip one byte and
 *    this step fails and nothing executes.
 * 3. Gate on the signal: only an "accumulate" signal above the conviction
 *    threshold is allowed to move value.
 * 4. Hand the exact, gated intent to KeeperHub: dry-run first (simulate, no
 *    chain), then execute the same workflow for real. KeeperHub owns nonce, gas,
 *    routing, retries and the audit trail.
 * 5. Print the transaction hash executed through KeeperHub — the proof.
 *
 * Run `npm run integrate -- --tamper` to alter the signal after signing and
 * watch verification reject it before KeeperHub is ever called: the executor
 * refuses unverified data.
 */
import { SignedAttestation, verifyAttestation } from "./attest.js";
import { KeeperHub } from "./keeperhub.js";

const SIGNAL_URL = process.env.PREDGE_SIGNAL_URL ?? "http://localhost:4055/v1/signal";
const PINNED_KEY = process.env.PREDGE_SIGNER_KEY_ID; // trust only this signer
const THRESHOLD = Number(process.env.CONVICTION_THRESHOLD ?? 70);
const TARGET = process.env.EXECUTION_TARGET_ADDRESS;
const NETWORK = process.env.NETWORK ?? "11155111"; // Sepolia
const WALLET = process.argv.find((a) => a.startsWith("0x")) ??
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const TAMPER = process.argv.includes("--tamper");

interface ConvictionSignal {
  wallet: string;
  conviction: number;
  action: "accumulate" | "reduce" | "hold";
  window: "7d" | "30d";
  source: string;
}

async function main() {
  // 1) Fetch the signed signal from Predge.
  const res = await fetch(`${SIGNAL_URL}/${WALLET}`);
  if (!res.ok) throw new Error(`Predge signal ${res.status}`);
  const signed = (await res.json()) as SignedAttestation;

  if (TAMPER) {
    // Bump the conviction after signing — exactly what a MITM or a hallucinating
    // agent would do. The signature no longer matches the bytes.
    (signed.attestation.payload as ConvictionSignal).conviction = 99;
  }

  // 2) Offline verification. No call back to Predge; just the pinned key.
  const check = await verifyAttestation(signed, PINNED_KEY);
  if (!check.ok) {
    console.error(`REJECTED: ${check.reason}. KeeperHub is never called.`);
    process.exit(2);
  }
  const sig = signed.attestation.payload as ConvictionSignal;
  console.log(`VERIFIED Predge signal  wallet=${sig.wallet} conviction=${sig.conviction} action=${sig.action} (${sig.window})`);

  // 3) Gate: only a high-conviction accumulate moves value.
  if (sig.action !== "accumulate" || sig.conviction < THRESHOLD) {
    console.log(`HOLD: signal does not clear the gate (need accumulate & conviction >= ${THRESHOLD}). No execution.`);
    return;
  }

  // 4) Deterministic execution through KeeperHub.
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey || !TARGET) {
    console.log("\nGate cleared. To execute the value movement through KeeperHub, set");
    console.log("KEEPERHUB_API_KEY and EXECUTION_TARGET_ADDRESS, fund the Turnkey wallet");
    console.log("with Sepolia gas, and re-run. The workflow is in workflow/predge-allocation.workflow.json.");
    return;
  }
  const kh = new KeeperHub({ apiKey });
  await kh.connect();

  // Allocation size scales with conviction (demo: tiny testnet amounts).
  // Human-readable and fixed precision so the idempotency body stays byte-stable.
  const amount = (sig.conviction / 100000).toFixed(6); // conviction 82 -> "0.000820"
  const idempotencyKey = `predge-${signed.attestation.nonce}`;

  console.log(`\nKeeperHub dry-run (simulate, no chain): transfer ${amount} on chain ${NETWORK} -> ${TARGET}`);
  const { dryRun, executed } = await kh.transfer({
    chainId: NETWORK,
    to: TARGET,
    amount,
    idempotencyKey,
  });
  if (!dryRun.ok) {
    console.error(`Dry-run would fail — not broadcasting:\n${dryRun.text}`);
    process.exit(3);
  }
  console.log("Dry-run clean.");
  console.log(`\nEXECUTED through KeeperHub`);
  if (executed?.txHash) console.log(`  tx:    ${executed.txHash}`);
  console.log(`  result: ${executed?.text?.slice(0, 500)}`);
  console.log(`\nVerified signal in, deterministic execution out.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
