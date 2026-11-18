import { NextRequest, NextResponse } from "next/server";
import { AccessError, accessResponse } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";

import { entities, mapRow } from "./entities";
import { financialReport, pipelineMetrics } from "../../finance";
import { isRecord, jsonObject, runCommand } from "../../../db/commands";
import { planMutation } from "./mutation";

import { uploadInput, fileFields, stageFile } from "../files/upload";

export const dynamic = "force-dynamic";

async function loadAll(){
  const env=getRuntimeEnv();
  const keys=Object.keys(entities);
  const results=await env.DB.batch(keys.map(key=>env.DB.prepare(`SELECT * FROM ${entities[key].table} ORDER BY updated_at DESC,id`)));
  const data=Object.fromEntries(keys.map((key,index)=>[key,(results[index].results??[]).map(row=>mapRow(row as Record<string,unknown>))]));
  const taskRows=data.tasks??[],tasks=new Map(taskRows.map((task:Record<string,unknown>)=>[String(task.id),task]));
  data.launchObjectives=(data.launchObjectives??[]).map((objective:Record<string,unknown>)=>{const linked=taskRows.filter((task:Record<string,unknown>)=>task.objectiveId===objective.id),countable=linked.filter((task:Record<string,unknown>)=>task.status!=="Cancelled"),completed=countable.filter((task:Record<string,unknown>)=>task.status==="Completed").length,blocked=countable.some((task:Record<string,unknown>)=>task.status==="Blocked"),started=countable.some((task:Record<string,unknown>)=>["In progress","In review","Completed"].includes(String(task.status))),status=!countable.length?"Not started":completed===countable.length?"Completed":blocked?"Blocked":started?"In progress":"Not started";return{...objective,status,taskCount:countable.length,completedTaskCount:completed,remainingTaskCount:Math.max(0,countable.length-completed),progressPercentage:countable.length?Math.round(completed/countable.length*100):0}});
  data.sprints=(data.sprints??[]).map((sprint:Record<string,unknown>)=>{
    const objectives=(data.sprintObjectives??[]).filter((item:Record<string,unknown>)=>item.sprintId===sprint.id);
    const sprintTasks=new Map(taskRows.filter((task:Record<string,unknown>)=>task.sprintId===sprint.id&&task.status!=="Cancelled").map((task:Record<string,unknown>)=>[String(task.id),task]));
    for(const objective of objectives){const linked=objective.taskId?tasks.get(String(objective.taskId)):undefined;if(linked&&linked.status!=="Cancelled")sprintTasks.set(String(linked.id),linked)}
    const standalone=objectives.filter((item:Record<string,unknown>)=>!item.taskId),completedTasks=[...sprintTasks.values()].filter((task:Record<string,unknown>)=>task.status==="Completed").length,complete=completedTasks+standalone.filter((item:Record<string,unknown>)=>item.status==="Completed").length,total=sprintTasks.size+standalone.length;
    return {...sprint,objectiveCount:total,completedObjectives:complete,completionPercentage:total?Math.round(complete/total*100):0};
  });
  data.projects=(data.projects??[]).map((project:Record<string,unknown>)=>{const related=(data.tasks??[]).filter((task:Record<string,unknown>)=>task.projectId===project.id&&task.status!=="Cancelled");const completed=related.filter((task:Record<string,unknown>)=>task.status==="Completed").length;return related.length?{...project,progress:Math.round(completed/related.length*100)}:project});
  return data;
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
    return NextResponse.json({ workspaceId: getRuntimeEnv().workspaceId, ...snapshot(await loadAll()) });
  } catch (error) { return accessResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    let result;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await request.formData().catch(() => { throw new AccessError(400, "Invalid upload"); });
      const file = form.get("file"), input = await uploadInput(file);
      let body: unknown;
      try { body = JSON.parse(String(form.get("command"))); } catch { throw new AccessError(400, "Invalid document command"); }
      if (!isRecord(body)) throw new AccessError(400, "Invalid document command");
      const command = body;
      result = await runCommand(request, { command, file: input }, async key => {
        const plan = await planMutation(command, key, await fileFields(key, input));
        const staged = await stageFile(key, file as File, input);
        return { result: plan.result, statements: [...staged.statements, ...plan.statements] };
      });
    } else {
      const body = await jsonObject(request);
      result = await runCommand(request, body, key => planMutation(body, key));
    }
    return NextResponse.json({ ...result, ...snapshot(await loadAll()) });
  } catch (error) { return accessResponse(error); }
}
