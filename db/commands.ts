import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { AccessError } from "../app/chatgpt-auth";
import { getRuntimeEnv } from "./runtime";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function jsonObject(request: Request) {
  let value: unknown;
  try { value = await request.json(); } catch { throw new AccessError(400, "Invalid JSON"); }
  if (!isRecord(value)) throw new AccessError(400, "Expected a command object");
  return value;
}

export async function digest(bytes: BufferSource) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export type CommandPlan<T> = { result: T; statements: D1PreparedStatement[] };

// An unsatisfied predicate violates the receipt's NOT NULL constraint. D1
// rolls the entire batch back, including any preceding record/audit writes.
export function requireAtCommit(key: string, predicate: string, ...values: unknown[]) {
  return getRuntimeEnv().DB.prepare(
    `UPDATE command_receipts SET result=NULL WHERE request_id=? AND NOT COALESCE((${predicate}), 0)`,
  ).bind(key, ...values);
}

export async function runCommand<T>(request: Request, payload: unknown, plan: (key: string, reserveProvider: () => Promise<boolean>) => Promise<CommandPlan<T>>): Promise<T> {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw new AccessError(400, "A valid Idempotency-Key is required");
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([new URL(request.url).pathname, canonical(payload)])));
  const { DB } = getRuntimeEnv();
  async function previous() {
    const receipt = await DB.prepare("SELECT fingerprint,result,created_at FROM command_receipts WHERE request_id=?").bind(key).first<{ fingerprint: string; result: string; created_at: string }>();
    if (receipt && receipt.fingerprint !== fingerprint) throw new AccessError(409, "Request key already belongs to a different command");
    return receipt;
  }
  const receipt = await previous();
  if (receipt && receipt.result !== "pending") return JSON.parse(receipt.result) as T;
  // The external provider has no transactional relationship with D1. Reserve
  // its single attempt before dispatch. A timed-out attempt finishes locally.
  async function reserveProvider() {
    const reserved = await DB.prepare("INSERT INTO command_receipts (request_id,fingerprint,result,created_at) VALUES (?,?,'pending',?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id")
      .bind(key, fingerprint, new Date().toISOString()).first();
    if (reserved) return true;
    const saved = await previous();
    if (!saved || saved.result !== "pending" || Date.now() - Date.parse(saved.created_at) < 25000) {
      throw new AccessError(409, "Answer in progress. Retry the same request shortly.");
    }
    return false;
  }
  try {
    const { result, statements } = await plan(key, reserveProvider);
    await DB.batch([
      DB.prepare(`INSERT INTO command_receipts (request_id,fingerprint,result,created_at) VALUES (?,?,?,?)
        ON CONFLICT(request_id) DO UPDATE SET result=CASE WHEN command_receipts.fingerprint=excluded.fingerprint
          AND command_receipts.result='pending' THEN excluded.result ELSE NULL END`)
        .bind(key, fingerprint, JSON.stringify(result), new Date().toISOString()),
      ...statements,
    ]);
    return result;
  } catch (error) {
    // Covers a competing commit and an acknowledgement lost after commit.
    const winner = await previous();
    if (winner && winner.result !== "pending") return JSON.parse(winner.result) as T;
    if (/command_receipts\.result|FOREIGN KEY constraint|Unregistered attachment/i.test(String(error))) {
      throw new AccessError(409, "Record, link or financial balance conflicts with this command. Refresh and review.");
    }
    throw error;
  }
}
