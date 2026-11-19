import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnv } from "../../../db/runtime";
import { jsonObject, runCommand } from "../../../db/commands";
import { AccessError, accessResponse } from "../../chatgpt-auth";
import { isAssistantPage, prepareAdvice } from "./advice";
import { conversation, decide } from "./history";

export const dynamic = "force-dynamic";

function validId(id: unknown): id is string {
  return typeof id === "string" && Boolean(id.trim()) && id.length <= 256;
}

export async function GET(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!validId(id)) throw new AccessError(400, "Choose a saved conversation");
    return NextResponse.json(await conversation(id));
  } catch (error) { return accessResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { DB, OPENAI_API_KEY } = getRuntimeEnv();
    const body = await jsonObject(request);
    if ("action" in body) {
      const { action, conversationId } = body;
      if (action !== "approve" && action !== "decline") throw new AccessError(403, "Assistant action unavailable");
      if (!validId(conversationId) || Object.keys(body).some(key => !["action", "conversationId"].includes(key))) {
        throw new AccessError(400, "Choose a saved request to approve or decline");
      }
      return NextResponse.json(await decide(request, { action, conversationId }));
    }
    const { page = "Mission Control", prompt = "What should I focus on today?", mode = "local" } = body;
    if (!isAssistantPage(page) || typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000
        || (mode !== "local" && mode !== "review") || Object.keys(body).some(key => !["page", "prompt", "mode"].includes(key))) {
      throw new AccessError(400, "Invalid assistant request");
    }

    // Preserve the receipt fingerprint of pre-consent clients and transcripts.
    const command = mode === "review" ? { page, prompt, mode } : { page, prompt };
    const { conversationId } = await runCommand(request, command, async key => {
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const { response, preview } = await prepareAdvice(page, prompt, mode === "review");
      const status = preview ? (OPENAI_API_KEY ? "pending" : "failed") : "local";
      return { result: { conversationId: id }, statements: [
        DB.prepare(`INSERT INTO ai_conversations
          (id,page,prompt,response,provider_status,provider_context,provider_issue,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .bind(id, page, prompt, response, status, status === "pending" ? preview : null, status === "failed" ? "unavailable" : null, now, now),
        DB.prepare(`INSERT INTO activity_logs (id,category,action,entity,record_id,label,metadata,created_at,updated_at)
          VALUES (?,'AI','create','aiConversations',?,?,?,?,?)`)
          .bind(crypto.randomUUID(), id, `Assistant question in ${page}`, JSON.stringify({requestId: key}), now, now),
      ] };
    });
    const turn = await conversation(conversationId);
    return NextResponse.json({ ...turn, conversationId });
  } catch (error) { return accessResponse(error); }
}
