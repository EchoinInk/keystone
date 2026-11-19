import { NextRequest, NextResponse } from "next/server";
import { AccessError, accessResponse } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";

import { entities, mapRow } from "./entities";
import { financialReport, pipelineMetrics } from "../../finance";
import { isRecord, jsonObject, runCommand } from "../../../db/commands";
import { projectWorkflows } from "../../workflows";
import { convertLead } from "./handoff";
import { planMutation } from "./mutation";
import { transcriptColumns } from "../assistant/history";

import { cleanFiles, pendingFileCleanup } from "../files/cleanup";
import { uploadForm, uploadInput, fileFields, stageFile } from "../files/upload";

export const dynamic = "force-dynamic";

async function loadAll(){
  const env=getRuntimeEnv();
  const keys=Object.keys(entities);
  const results = await env.DB.batch(keys.map(key => {
    if (key === "documents") return env.DB.prepare(`SELECT d.*, f.name AS attachment_name FROM documents d LEFT JOIN workspace_files f ON f.object_key=d.object_key ORDER BY d.updated_at DESC,d.id`);
    if (key === "aiConversations") return env.DB.prepare(`SELECT ${transcriptColumns} FROM ai_conversations ORDER BY created_at DESC,id`);
    return env.DB.prepare(`SELECT * FROM ${entities[key].table} ORDER BY updated_at DESC,id`);
  }));
  const data=Object.fromEntries(keys.map((key,index)=>[key,(results[index].results??[]).map(row=>mapRow(row as Record<string,unknown>))]));
  return projectWorkflows(data);
}

function snapshot(data: Record<string, Array<Record<string, unknown>>>) {
  const report = financialReport(data.invoices, data.payments, data.expenses, new Date(), data.revenueGoals);
  const { month, revenue } = report.metrics;
  const today = new Date().toISOString().slice(0, 10);
  const { weightedPipeline, pipelineValue } = pipelineMetrics(data.leads);
  const goal = Number(data.revenueGoals.find(row => row.period === month)?.target ?? 0);
  const dueTasks=(data.tasks??[]).filter(x=>!["Completed","Cancelled"].includes(String(x.status))&&x.dueDate&&String(x.dueDate)<=today).length;
  const upcomingMeetings=(data.meetings??[]).filter(x=>String(x.startsAt)>=new Date().toISOString()).length;
  return { data: { ...data, invoices: report.balances.map(row => ({ ...row, recordedStatus: row.status, status: row.settlementStatus })) }, reconciliation: report.issues,
    metrics: { ...report.metrics, weightedPipeline, pipelineValue, goal, dueTasks, upcomingMeetings,
      goalProgress: goal ? Math.min(100, Math.round(revenue / goal * 100)) : 0,
      activeClients: data.clients.filter(row => row.status === "Active").length } };
}

export async function GET() {
  try {
    const { workspaceId, OPENAI_API_KEY } = getRuntimeEnv();
    return NextResponse.json({ workspaceId, assistantProviderAvailable: Boolean(OPENAI_API_KEY), ...snapshot(await loadAll()),
      cleanup: { pending: await pendingFileCleanup() } });
  } catch (error) { return accessResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    let result, documentChange = false;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await uploadForm(request);
      const file = form.get("file"), input = await uploadInput(file);
      let body: unknown;
      try { body = JSON.parse(String(form.get("command"))); } catch { throw new AccessError(400, "Invalid document command"); }
      if (!isRecord(body)) throw new AccessError(400, "Invalid document command");
      const command = body;
      documentChange = true;
      result = await runCommand(request, { command, file: input }, async key => {
        const plan = await planMutation(command, key, await fileFields(key, input));
        const staged = await stageFile(key, file as File, input);
        return { result: plan.result, statements: [...staged.statements, ...plan.statements] };
      });
    } else {
      const body = await jsonObject(request);
      documentChange = body.entity === "documents";
      result = await runCommand(request, body, key => body.action === "convert" ? convertLead(body, key) : planMutation(body, key));
    }
    // Revocation is already committed. Retrying a lost response also retries cleanup.
    const cleanup = documentChange ? await cleanFiles().catch(() => ({ pending: true })) : undefined;
    return NextResponse.json({ ...result, cleanup, ...snapshot(await loadAll()) });
  } catch (error) { return accessResponse(error); }
}
