/**
 * Predge signal service — the "verified input" half of the integration.
 *
 * Predge is a live project: verifiable smart-money data served over x402 (27
 * monetised routes on Base, plus Arc and Robinhood Chain, and a public
 * leaderboard of 50 top wallets ranked by on-chain conviction). This service
 * fronts one of those signals for KeeperHub to consume, and does the one thing
 * that matters for onchain execution: it signs the signal.
 *
 * An agent (or a KeeperHub workflow) fetches a signal, verifies the ed25519
 * signature offline against Predge's published key, and only then lets
 * KeeperHub move value on it. Flip one byte of the signal and verification
 * fails, so a probabilistic agent can never act on data it cannot prove.
 *
 * In production the payload is Predge's real conviction score and the call is
 * paid per-request in USDC over x402. Here the score is a labelled, deterministic
 * sample so the integration runs end-to-end without a funded buyer; the
 * signature, the canonical encoding and the offline check are the real
 * guarantee and are identical to production.
 */
import express from "express";
import {
  Attestation,
  SCHEME,
  SignedAttestation,
  newKeypair,
  signAttestation,
} from "./attest.js";
import { bytesToHex } from "@noble/hashes/utils";
import { randomBytes } from "node:crypto";

if (process.argv.includes("--new-key")) {
  const { privateKeyHex, keyId } = await newKeypair();
  console.log("PREDGE_SIGNER_PRIVATE_KEY=" + privateKeyHex);
  console.log("PREDGE_SIGNER_KEY_ID=" + keyId);
  process.exit(0);
}

const PORT = Number(process.env.PORT ?? 4055);
const PRIVATE_KEY = process.env.PREDGE_SIGNER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("Set PREDGE_SIGNER_PRIVATE_KEY (run: npm run signal -- --new-key).");
  process.exit(1);
}

/** Predge's conviction signal for a wallet, shaped for onchain execution. */
interface ConvictionSignal {
  wallet: string;
  /** 0-100 conviction from Predge's on-chain track-record model. */
  conviction: number;
  /** "accumulate" | "reduce" | "hold" — what an executor should do. */
  action: "accumulate" | "reduce" | "hold";
  /** Predge's window for the score. Never 90d — 7d/30d only. */
  window: "7d" | "30d";
  source: "predge-leaderboard";
}

// Deterministic sample track-records. In production this reads Predge's live
// scorer; the shape and the signature are identical.
const SAMPLE: Record<string, ConvictionSignal> = {
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    wallet: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    conviction: 82,
    action: "accumulate",
    window: "30d",
    source: "predge-leaderboard",
  },
  "0x000000000000000000000000000000000000dead": {
    wallet: "0x000000000000000000000000000000000000dead",
    conviction: 21,
    action: "reduce",
    window: "30d",
    source: "predge-leaderboard",
  },
};

const app = express();

app.get("/v1/signal/:wallet", async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  const signal = SAMPLE[wallet];
  if (!signal) return res.status(404).json({ error: "no signal for wallet" });

  const attestation: Attestation = {
    scheme: SCHEME,
    resource: `conviction:${wallet}`,
    payload: signal,
    issuedAt: new Date().toISOString(),
    nonce: bytesToHex(randomBytes(16)),
    keyId: process.env.PREDGE_SIGNER_KEY_ID ?? "",
  };
  const signed: SignedAttestation = await signAttestation(attestation, PRIVATE_KEY);
  res.json(signed);
});

app.get("/.well-known/predge-keys.json", (_req, res) => {
  res.json({ keys: [{ scheme: SCHEME, keyId: process.env.PREDGE_SIGNER_KEY_ID ?? "" }] });
});

app.listen(PORT, () => {
  console.log(`Predge signal service on http://localhost:${PORT}`);
  console.log(`  GET /v1/signal/:wallet -> SignedAttestation`);
  console.log(`  GET /.well-known/predge-keys.json`);
});
