import { getRuntimeEnv } from "../../../db/runtime";
import { runCommand } from "../../../db/commands";
import { AccessError } from "../../chatgpt-auth";
import type { Conversation } from "../../assistant-types";
import { providerTimeoutMs, requestSuggestion } from "./provider";

// An interrupted Worker may never run a finally block. Readers must be able
// to show a terminal outcome without issuing writes or another provider call.
const expiredAttempt = `provider_status='running' AND julianday(provider_started_at)
  <= julianday('now','-${providerTimeoutMs / 1000 + 10} seconds')`;
export const transcriptColumns = `id,page,prompt,response,created_at AS createdAt,updated_at AS updatedAt,
  approved_at AS approvedAt,
  CASE WHEN ${expiredAttempt} THEN 'failed' ELSE provider_status END AS providerStatus,
  CASE WHEN ${expiredAttempt} THEN 'interrupted' ELSE provider_issue END AS providerIssue`;

export async function conversation(id: string) {
  const { DB } = getRuntimeEnv();
  const turn = await DB.prepare(`SELECT ${transcriptColumns},
    CASE WHEN provider_status='pending' THEN provider_context END AS preview FROM ai_conversations WHERE id=?`)
    .bind(id).first<Conversation>();
  if (!turn) throw new AccessError(404, "Conversation unavailable");
  return turn;
}

type Decision = { action: "approve" | "decline"; conversationId: string };

async function dispatchApproved(id: string) {
  const { DB, OPENAI_API_KEY } = getRuntimeEnv();
  const input = await DB.prepare("SELECT provider_context FROM ai_conversations WHERE id=? AND provider_status='approved'")
    .bind(id).first<{ provider_context: string }>();
  if (!input) {
    await DB.prepare(`UPDATE ai_conversations SET provider_status='failed',provider_issue='interrupted',updated_at=?
      WHERE id=? AND ${expiredAttempt}`).bind(new Date().toISOString(), id).run();
    return;
  }

  const now = new Date(), hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  // Only the request that wins this durable claim may contact OpenAI, even
  // when two approvals arrive with different command keys.
  const claim = OPENAI_API_KEY && await DB.prepare(`UPDATE ai_conversations
    SET provider_status='running',provider_context=NULL,provider_started_at=?,updated_at=?
    WHERE id=? AND provider_status='approved'
    AND (SELECT COUNT(*) FROM ai_conversations WHERE provider_started_at>?) < 20 RETURNING id`)
    .bind(now.toISOString(), now.toISOString(), id, hourAgo).first();
  if (!claim) {
    await DB.prepare(`UPDATE ai_conversations SET provider_status='failed',provider_issue=?,provider_context=NULL,updated_at=?
      WHERE id=? AND provider_status='approved'`)
      .bind(OPENAI_API_KEY ? "rate_limited" : "unavailable", now.toISOString(), id).run();
    return;
  }

  const answer = await requestSuggestion(input.provider_context);
  const failed = "issue" in answer;
  await DB.prepare(`UPDATE ai_conversations SET provider_status=?,provider_issue=?,response=COALESCE(?,response),updated_at=?
    WHERE id=? AND provider_status='running' AND NOT (${expiredAttempt})`)
    .bind(failed ? "failed" : "completed", failed ? answer.issue : null, failed ? null : answer.text, new Date().toISOString(), id).run();
}

export async function decide(request: Request, decision: Decision) {
  const { DB } = getRuntimeEnv();
  const { action, conversationId } = decision;
  const approve = action === "approve";
  function matches(turn: Conversation) {
    return approve ? Boolean(turn.approvedAt) && turn.providerStatus !== "declined" : turn.providerStatus === "declined";
  }
  const conflict = () => new AccessError(409, "This conversation has no OpenAI request awaiting that decision.");
  await runCommand(request, decision, async () => {
    const turn = await conversation(conversationId);
    const canWithdraw = !approve && turn.providerStatus === "approved";
    if (turn.providerStatus !== "pending" && !canWithdraw && !matches(turn)) throw conflict();
    const now = new Date().toISOString();
    const update = approve
      ? DB.prepare(`UPDATE ai_conversations SET provider_status='approved',approved_at=?,updated_at=?
          WHERE id=? AND provider_status='pending'`).bind(now, now, conversationId)
      : DB.prepare(`UPDATE ai_conversations SET provider_status='declined',provider_context=NULL,updated_at=?
          WHERE id=? AND provider_status IN ('pending','approved')`).bind(now, conversationId);
    return { result: { conversationId }, statements: [update] };
  });
  // An opposite decision from another tab may have won the conditional update.
  const decided = await conversation(conversationId);
  if (!matches(decided)) throw conflict();
  if (!approve) return decided;
  await dispatchApproved(conversationId);
  return conversation(conversationId);
}
