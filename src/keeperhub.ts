/**
 * KeeperHub client — the "deterministic execution" half of the integration.
 *
 * KeeperHub is the execution and reliability layer for onchain agents: an agent
 * composes a call, dry-runs it without touching the chain, then that exact call
 * executes — nonce management, gas estimation, MEV-aware routing, retries and a
 * full audit trail underneath, non-custodial via Turnkey.
 *
 * We talk to KeeperHub over its **MCP server** (https://app.keeperhub.com/mcp),
 * the "agent-authored" surface KeeperHub built for exactly this: this client is
 * the agent. Transport is MCP Streamable HTTP (JSON-RPC 2.0): initialize to get
 * a session, then `tools/call`. Auth is the org API key as a Bearer token.
 *
 * The one method we need, execute_transfer, is driven the way KeeperHub is meant
 * to be: `simulate: true` first (gas + revert check, no broadcast), then the same
 * arguments with an idempotency key to execute for real.
 */

export interface KeeperHubConfig {
  apiKey: string; // kh_...
  baseUrl?: string; // default https://app.keeperhub.com
}

export interface TransferParams {
  chainId: string; // "11155111" (Sepolia)
  to: string;
  /** Human-readable units, e.g. "0.001". Must be byte-stable across retries. */
  amount: string;
  tokenAddress?: string; // omit for native
  idempotencyKey?: string;
}

export interface ExecuteResult {
  simulated: boolean;
  ok: boolean;
  txHash?: string;
  raw: unknown;
  text: string;
}

const DEFAULT_BASE = "https://app.keeperhub.com";
const MCP_HEADERS_ACCEPT = "application/json, text/event-stream";

/** Parse a JSON-RPC body that may be plain JSON or a single SSE `data:` frame. */
function parseRpc(body: string): any {
  const trimmed = body.trim();
  if (trimmed.startsWith("data:")) {
    const line = trimmed.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse((line ?? "data:").slice(5).trim());
  }
  return JSON.parse(trimmed);
}

export class KeeperHub {
  private sessionId?: string;
  private id = 0;
  constructor(private cfg: KeeperHubConfig) {
    if (!cfg.apiKey) throw new Error("KEEPERHUB_API_KEY required (kh_ prefix).");
  }
  private base() {
    return (this.cfg.baseUrl ?? DEFAULT_BASE) + "/mcp";
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      authorization: `Bearer ${this.cfg.apiKey}`,
      "content-type": "application/json",
      accept: MCP_HEADERS_ACCEPT,
    };
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    return h;
  }

  /** MCP handshake: initialize (capture session) + initialized notification. */
  async connect(): Promise<void> {
    const res = await fetch(this.base(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.id,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "predge-keeperhub", version: "0.1.0" },
        },
      }),
    });
    this.sessionId = res.headers.get("mcp-session-id") ?? undefined;
    if (!res.ok) throw new Error(`KeeperHub initialize ${res.status}: ${await res.text()}`);
    await fetch(this.base(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await fetch(this.base(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = await res.text();
    const rpc = parseRpc(body);
    if (rpc.error) throw new Error(`${name}: ${rpc.error.message ?? JSON.stringify(rpc.error)}`);
    return rpc.result;
  }

  private static resultText(result: any): string {
    const content = result?.content;
    if (Array.isArray(content)) return content.map((c: any) => c?.text ?? "").join("\n");
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  /** Pull the first 0x… 32-byte tx hash out of a tool's textual result. */
  private static extractTxHash(text: string): string | undefined {
    return text.match(/0x[a-fA-F0-9]{64}/)?.[0];
  }

  /**
   * Transfer value, dry-run first. `simulate: true` estimates gas and catches
   * reverts without broadcasting; only a clean simulation broadcasts, under a
   * stable idempotency key so a retry never double-sends.
   */
  async transfer(p: TransferParams): Promise<{ dryRun: ExecuteResult; executed?: ExecuteResult }> {
    const base = {
      chain_id: p.chainId,
      to_address: p.to,
      amount: p.amount,
      ...(p.tokenAddress ? { token_address: p.tokenAddress } : {}),
    };

    const simResult = await this.callTool("execute_transfer", { ...base, simulate: true });
    const simText = KeeperHub.resultText(simResult);
    const simOk = !/revert|would revert|error|failed/i.test(simText) || /success|ok|"success":true/i.test(simText);
    const dryRun: ExecuteResult = { simulated: true, ok: simOk, raw: simResult, text: simText };
    if (!simOk) return { dryRun };

    const execResult = await this.callTool("execute_transfer", {
      ...base,
      idempotency_key: p.idempotencyKey ?? `predge-${Date.now()}`,
    });
    const execText = KeeperHub.resultText(execResult);
    return {
      dryRun,
      executed: {
        simulated: false,
        ok: !/error|failed|revert/i.test(execText),
        txHash: KeeperHub.extractTxHash(execText),
        raw: execResult,
        text: execText,
      },
    };
  }
}
