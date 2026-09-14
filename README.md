# Predge × KeeperHub — verified signal in, deterministic execution out

**KeeperHub integration for the Agent Economy Hackathon (main track: Best Integration into a Live Project).**

An agent reads a **Predge**-signed conviction signal, verifies the signature offline, and only then lets **KeeperHub** move value on-chain — dry-run first, then the exact workflow executes, with a full audit trail. Neither the data nor the execution is left to a probabilistic agent to reinterpret.

- **Live project integrated:** [Predge](https://predge.io) — verifiable smart-money data over x402. Live on Base (27 monetised x402 routes), Arc and Robinhood Chain, with a public leaderboard of 50 top wallets ranked by on-chain conviction.
- **KeeperHub surfaces used:** MCP (agent-authored workflows), x402, deterministic execution (`simulate` → execute), audit trail.
- **Proof of execution:** `TX: <pending — filled once executed through KeeperHub on Sepolia>`

## The gap this closes

KeeperHub's own thesis: agents are probabilistic, and on-chain value transfer does not forgive that — so KeeperHub removes the reinterpretation at *execution* time. Ask it to move funds and it moves the exact workflow you dry-ran, nothing inferred.

Predge is the mirror image on the *data* side. Ask an agent to act on a number — a wallet's edge, a counterparty's track record — and nothing proves the number is real. Predge signs it: every signal carries a detached ed25519 attestation an agent can verify offline against a published key.

Put them together and a probabilistic agent is boxed in from both ends:

> **Predge proves the input. KeeperHub makes the output deterministic and auditable.**

That is the whole loop the agent economy is missing — trust the data you pay for, *and* trust the execution that follows from it — and it is exactly the seam where a Predge signal becomes a KeeperHub transaction.

## What it does

1. **Predge signs a signal.** `src/signal.ts` serves a conviction signal for a wallet (0–100, plus an `accumulate | reduce | hold` action) as a `SignedAttestation` — an ed25519 signature over a canonical encoding of the payload. In production this is a real per-call x402 purchase off the Predge leaderboard; here the score is a labelled sample and the signature is real.
2. **The agent verifies offline.** `src/integrate.ts` fetches the signal and verifies it against Predge's pinned key with no call back to the server. Tamper with one byte and verification fails before KeeperHub is ever touched.
3. **The gate.** Only a high-conviction `accumulate` (default: conviction ≥ 70) is allowed to move value.
4. **KeeperHub executes.** The gated intent goes to KeeperHub via `src/keeperhub.ts`: `simulate: true` dry-runs it (gas + revert check, no chain), then the same call broadcasts with an idempotency key. Nonce management, MEV-aware routing, retries and the audit trail are KeeperHub's. The workflow is also expressed declaratively in `workflow/predge-allocation.workflow.json`.
5. **Proof.** The integration prints the transaction hash executed through KeeperHub.

```
Predge signal  ──sign──▶  SignedAttestation
                              │  fetch + verify offline (ed25519)
                              ▼
                        gate: accumulate & conviction ≥ 70
                              │
                              ▼
KeeperHub  ──simulate──▶ dry-run (no chain) ──▶ execute ──▶ tx + audit trail
```

## Reliability (the part that is not the happy path)

- **Tampered signal → no execution.** `npm run integrate -- --tamper` alters the conviction after signing; verification rejects it and KeeperHub is never called.
- **Would-revert → no broadcast.** The KeeperHub dry-run (`simulate`) catches reverts and gas failures before anything is broadcast.
- **Cold start → bounded retry.** The client honours KeeperHub's `upstream_cold_start` signal with backoff and a stable `idempotency_key`, so a wake-from-idle never double-executes.

## Which KeeperHub surfaces

- **MCP / agent-authored workflows** — the workflow is composed by an agent through KeeperHub's MCP server (`app.keeperhub.com/mcp`), the surface KeeperHub built for exactly this.
- **x402** — Predge is x402-native (the signal is a per-call USDC purchase), and KeeperHub speaks x402 for paid workflows, so the payment rail is shared end to end.
- **Deterministic execution + audit trail** — `simulate` then execute, with KeeperHub's run log as the record.

## Form answers

- **Which project did you integrate with, and what does the integration do?** Predge (live: Base/Arc/Robinhood, 27 x402 routes, public leaderboard). The integration makes KeeperHub the execution layer for Predge signals: an agent buys and verifies a Predge conviction signal, and KeeperHub deterministically moves value when the signal clears a gate.
- **Which KeeperHub surfaces did you use?** MCP (agent-authored workflows), x402, `simulate`→execute deterministic execution, audit trail.
- **Testnet or mainnet?** Sepolia (chain id 11155111) for the demo execution; the Predge signal side is live.
- **What still breaks or is unfinished?** In-workflow x402 payment for the signal is handled by the agent rather than a native KeeperHub HTTP node; allocation sizing is a simple linear function of conviction; only `accumulate` is wired to an action. Candidly: the point we are proving is the seam (verified signal → gated, dry-run, audited execution), not the trading strategy.

## Bounty (separate BUIDL): Best KeeperHub Feature

Stacking submission — a PR to `github.com/keeperhub/keeperhub`: a **Predge signal plugin** (a condition/trigger node that fetches a Predge attestation and exposes `conviction`, `action` and a verified-signature boolean to a workflow), scaffolded with `pnpm create-plugin` in `plugins/`. Judged on mergeability; lets any KeeperHub workflow gate on verified Predge data without leaving KeeperHub.

## Run it

```bash
npm install
cp .env.example .env
npm run signal -- --new-key   # generates PREDGE_SIGNER_PRIVATE_KEY + KEY_ID; put them in .env
npm run signal                # terminal 1: Predge signal service
npm run integrate             # terminal 2: verify + gate (+ execute if KeeperHub env is set)
npm run integrate -- --tamper # verification rejects a tampered signal
```

To execute for real through KeeperHub: set `KEEPERHUB_API_KEY` (kh_ key from app.keeperhub.com) and `EXECUTION_TARGET_ADDRESS`, fund the Turnkey wallet with Sepolia gas, and re-run `npm run integrate`.

## Demo video (≤ 3 min)

1. **The gap.** "Agents are probabilistic. KeeperHub makes the *execution* deterministic; Predge makes the *input* verifiable. Here they meet."
2. **Verify.** Run `npm run integrate` — show `VERIFIED Predge signal … conviction=82 action=accumulate`, gate clears.
3. **Execute.** Show KeeperHub dry-run then the real Sepolia tx hash; open the tx and the KeeperHub audit trail.
4. **Tamper.** Run with `--tamper` — `REJECTED … KeeperHub is never called.`
5. **Close.** "Verified signal in, deterministic execution out."
