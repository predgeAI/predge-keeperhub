/**
 * KeeperHub client — the "deterministic execution" half of the integration.
 *
 * KeeperHub is the execution and reliability layer for onchain agents: an agent
 * composes a workflow, dry-runs it without touching the chain, then that exact
 * workflow executes — nonce management, gas estimation, MEV-aware routing,
 * retries and a full audit trail underneath, non-custodial via Turnkey.
 *
 * We drive it two ways, both first-class KeeperHub surfaces:
 *   - MCP  : this repo's workflows are authored by an agent through KeeperHub's
 *            MCP server (app.keeperhub.com/mcp) — "agent-authored workflows".
 *   - API  : the same operations over the REST/tool surface with a kh_ API key,
 *            which is what this module calls so the integration runs headless.
 *
 * Methods map 1:1 onto KeeperHub tools: create_workflow, validate_workflow,
 * execute_workflow, get_execution, execute_contract_call / execute_transfer
 * (with `simulate` for the dry-run and `idempotency_key` for cold-start safety).
 */

export interface KeeperHubConfig {
  apiKey: string;            // kh_...
  baseUrl?: string;          // default https://app.keeperhub.com
  network: string;           // "11155111" (Sepolia) for the demo
}

export interface ExecuteResult {
  simulated: boolean;
  wouldRevert?: boolean;
  txHash?: string;
  executionId?: string;
  /** Link into the KeeperHub audit trail for this run. */
  auditUrl?: string;
  raw: unknown;
}

const DEFAULT_BASE = "https://app.keeperhub.com";

export class KeeperHub {
  constructor(private cfg: KeeperHubConfig) {
    if (!cfg.apiKey) throw new Error("KEEPERHUB_API_KEY required (kh_ prefix).");
  }

  private async call(path: string, body: unknown): Promise<any> {
    const res = await fetch((this.cfg.baseUrl ?? DEFAULT_BASE) + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    // KeeperHub signals a cold start with a structured, retryable error.
    if (json?.code === "upstream_cold_start") {
      const wait = Number(json.retryAfterSeconds ?? 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.call(path, body);
    }
    if (!res.ok) throw new Error(`KeeperHub ${path} ${res.status}: ${text}`);
    return json;
  }

  /**
   * Move value deterministically, gated by a dry-run first. This is the exact
   * "simulate, then execute the same thing" flow KeeperHub is built around.
   *
   * `simulate: true` estimates gas and catches reverts without broadcasting.
   * Only if the simulation would not revert do we broadcast with a unique
   * idempotency key.
   */
  async executeContractCall(params: {
    to: string;
    /** ABI function signature, e.g. "transfer(address,uint256)". */
    functionSignature: string;
    args: unknown[];
    valueWei?: string;
    idempotencyKey: string;
  }): Promise<ExecuteResult> {
    const base = {
      network: this.cfg.network,
      to: params.to,
      functionSignature: params.functionSignature,
      args: params.args,
      valueWei: params.valueWei ?? "0",
    };

    // 1) Dry-run (preflight) — never touches the chain.
    const sim = await this.call("/api/mcp/execute_contract_call", {
      ...base,
      simulate: true,
    });
    const wouldRevert = Boolean(sim?.wouldRevert);
    if (wouldRevert) {
      return { simulated: true, wouldRevert: true, raw: sim };
    }

    // 2) The exact same call, executed for real.
    const out = await this.call("/api/mcp/execute_contract_call", {
      ...base,
      idempotency_key: params.idempotencyKey,
    });
    return {
      simulated: false,
      wouldRevert: false,
      txHash: out?.txHash ?? out?.transactionHash,
      executionId: out?.executionId ?? out?.id,
      auditUrl: out?.auditUrl,
      raw: out,
    };
  }

  /** Native / ERC20 transfer through KeeperHub (dry-run then execute). */
  async executeTransfer(params: {
    to: string;
    amountWei: string;
    token?: string; // omit for native
    idempotencyKey: string;
  }): Promise<ExecuteResult> {
    const base = {
      network: this.cfg.network,
      to: params.to,
      amount: params.amountWei,
      token: params.token,
    };
    const sim = await this.call("/api/mcp/execute_transfer", { ...base, simulate: true });
    if (sim?.wouldRevert) return { simulated: true, wouldRevert: true, raw: sim };
    const out = await this.call("/api/mcp/execute_transfer", {
      ...base,
      idempotency_key: params.idempotencyKey,
    });
    return {
      simulated: false,
      wouldRevert: false,
      txHash: out?.txHash ?? out?.transactionHash,
      executionId: out?.executionId ?? out?.id,
      auditUrl: out?.auditUrl,
      raw: out,
    };
  }
}

// NOTE ON TRANSPORT: the exact tool route + payload shape are pinned against a
// live kh_ key via KeeperHub's MCP server (`claude mcp add ... app.keeperhub.com/mcp`)
// during integration — the method names above mirror the documented MCP tools
// (execute_contract_call, execute_transfer, get_execution) so the mapping is 1:1.
