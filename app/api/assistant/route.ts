import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnv } from "../../../db/runtime";
import { AccessError, accessResponse } from "../../chatgpt-auth";

import { financialReport, pipelineMetrics } from "../../finance";
import { jsonObject, runCommand } from "../../../db/commands";

const pageTables:Record<string,string[]>={
  "Mission Control":["tasks","meetings","invoices","payments","leads","clients","projects","sprints","sprint_objectives","activity_logs"],
  Tasks:["tasks","projects","clients","sprints","sprint_objectives"],Sprints:["sprints","sprint_objectives","tasks","daily_reviews","projects"],Activity:["activity_logs","clients","projects","invoices","tasks"],
  Revenue:["invoices","payments","expenses","revenue_goals","leads","subscriptions"],Clients:["leads","clients","projects","invoices","meetings","notes"],
  Projects:["projects","tasks","milestones","time_entries","invoices"],Products:["products","services","projects"],Content:["content","projects","knowledge"],
  Finance:["invoices","payments","expenses","subscriptions","revenue_goals"],"Knowledge Base":["knowledge","notes","documents","clients","projects","meetings","invoices"],
};

async function contextFor(page: string) {
  const { DB } = getRuntimeEnv();
  const requested = Object.hasOwn(pageTables, page) ? pageTables[page] : pageTables["Mission Control"];
  const tables = requested.filter(name => !["invoices", "payments", "expenses", "revenue_goals"].includes(name));
  const results = await DB.batch(tables.map(table => DB.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC LIMIT 40`)));
  const context: Record<string, unknown> = Object.fromEntries(tables.map((name, i) => [name, results[i].results]));
  if (requested.length !== tables.length) context.financialSummary = await financialAdvice();
  return context;
}
const cash=(value:number)=>new Intl.NumberFormat("en-NZ",{style:"currency",currency:"NZD",maximumFractionDigits:2}).format(value);

function localAnalysis(page:string,prompt:string,context:Record<string,unknown>){
  const rows=(name:string)=>(context[name]??[]) as Record<string,unknown>[];
  const tasks=rows("tasks"),projects=rows("projects"),clients=rows("clients"),knowledge=rows("knowledge"),meetings=rows("meetings");
  const q=prompt.toLowerCase(),today=new Date().toISOString().slice(0,10);
  if(q.includes("client")||q.includes("attention")){
    const recent=clients.filter(client=>Date.now()-new Date(String(client.updated_at)).getTime()<14*86400000);const stale=clients.filter(client=>!recent.includes(client));
    return stale.length?`${stale.length} client${stale.length===1?"":"s"} have had no recorded update in the last 14 days. Start with ${String(stale[0].company||stale[0].name)} and log a clear next action after contact.`:`All ${clients.length} stored clients have recent activity. Focus next on the highest-value open lead and convert its next action into a dated task.`;
  }
  if(q.includes("risk")||q.includes("completion")||page==="Projects"){
    const late=projects.filter(x=>x.due_date&&String(x.due_date)<today&&x.status!=="Complete"),blocked=tasks.filter(x=>x.status==="Blocked");
    return `${late.length} project${late.length===1?"":"s"} are past their due date and ${blocked.length} task${blocked.length===1?" is":"s are"} blocked. ${late[0]?`Review ${late[0].name} first.`:blocked[0]?`Unblock “${blocked[0].title}” first.`:"No immediate delivery risk is visible in stored records."} Estimate completion from completed linked tasks, then set the next milestone.`;
  }
  if(q.includes("knowledge")||q.includes("document")||q.includes("branding")||q.includes("aquafit")||page==="Knowledge Base"){
    const terms=q.split(/\W+/).filter(x=>x.length>3);const matches=knowledge.filter(doc=>terms.some(term=>JSON.stringify(doc).toLowerCase().includes(term)));
    return matches.length?`I found ${matches.length} relevant knowledge record${matches.length===1?"":"s"}: ${matches.slice(0,5).map(x=>x.title).join(", ")}. Open these records to review their links, tags and revision history.`:`No stored knowledge record clearly matches that question yet. Add or link the source notes, documents, meetings or invoices, then ask again.`;
  }
  const open=tasks.filter(x=>!["Completed","Cancelled"].includes(String(x.status))).sort((a,b)=>String(a.due_date??"9999").localeCompare(String(b.due_date??"9999")));
  const nextMeeting=meetings.filter(x=>String(x.starts_at)>=new Date().toISOString()).sort((a,b)=>String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  return `${open.length} open task${open.length===1?"":"s"} are in scope. Your best next action is ${open[0]?`“${open[0].title}”${open[0].due_date?` (due ${open[0].due_date})`:""}`:"to create one dated, high-value task"}.${nextMeeting?` Your next meeting is “${nextMeeting.title}”.`:""} This recommendation is based only on stored ${page} data.`;
}

async function financialAdvice() {
  const { DB } = getRuntimeEnv();
  const [invoices, payments, expenses, leads, goals] = await DB.batch<Record<string, unknown>>([
    DB.prepare("SELECT id,number,amount,tax,status,due_date AS dueDate FROM invoices ORDER BY due_date IS NULL,due_date,number,id"),
    DB.prepare("SELECT id,invoice_id AS invoiceId,amount,paid_at AS paidAt,reference FROM payments"),
    DB.prepare("SELECT id,amount,incurred_at AS incurredAt FROM expenses"),
    DB.prepare("SELECT stage,status,value,probability FROM leads"),
    DB.prepare("SELECT id,period,target FROM revenue_goals ORDER BY updated_at DESC,id"),
  ]);
  const report = financialReport(invoices.results, payments.results, expenses.results, new Date(), goals.results);
  const followUp = report.balances.filter(row => row.balance > 0);
  const { weightedPipeline } = pipelineMetrics(leads.results);
  const first = followUp[0];
  return `Collected revenue for ${report.metrics.month} is ${cash(report.metrics.revenue)}. Expenses are ${cash(report.metrics.monthExpenses)}. Outstanding is ${cash(report.metrics.outstanding)}. ${followUp.length} invoice${followUp.length === 1 ? "" : "s"} ${followUp.length === 1 ? "requires" : "require"} follow-up${first ? `, starting with ${first.number} (${cash(first.balance)} due)` : ""}. Weighted pipeline is ${cash(weightedPipeline)}.${report.issues.length ? " Totals are provisional. Review the financial reconciliation findings." : ""}`;
}

export async function POST(request: NextRequest) {
  try {
    const env = getRuntimeEnv();
    const { page = "Mission Control", prompt = "What should I focus on today?" } = await jsonObject(request);
    if (typeof page !== "string" || !page.trim() || page.length > 100 || typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000) {
      throw new AccessError(400, "Invalid assistant request");
    }
    const { conversationId } = await runCommand(request, { page, prompt }, async (key, reserveProvider) => {
      const finance = ["Finance", "Revenue"].includes(page) || /invoic|income|revenue|forecast|receipt|payment|balance|outstanding|cash|expense|profit|settle|pipeline/i.test(prompt);
      let response;
      if (finance) {
        response = await financialAdvice();
      } else {
        const context = await contextFor(page);
        response = localAnalysis(page, prompt, context);
        if (env.OPENAI_API_KEY && await reserveProvider()) {
          try {
            const result = await fetch("https://api.openai.com/v1/responses", {
              method: "POST", signal: AbortSignal.timeout(20000),
              headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
              body: JSON.stringify({ model: env.OPENAI_MODEL ?? "gpt-5-mini", input: [
                { role: "system", content: `Answer from the supplied Founder OS data. Page: ${page}. Data: ${JSON.stringify(context)}` },
                { role: "user", content: prompt },
              ] }),
            });
            if (result.ok) {
              const json = await result.json() as { output_text?: string };
              if (typeof json.output_text === "string" && json.output_text.trim()) response = json.output_text;
            }
          } catch { /* The local answer is available if the provider is interrupted. */ }
        }
      }
      const timestamp = new Date().toISOString(), id = crypto.randomUUID();
      return { result: { conversationId: id }, statements: [
        env.DB.prepare("INSERT INTO ai_conversations (id,page,prompt,response,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,page,prompt,response,timestamp,timestamp),
        env.DB.prepare("INSERT INTO activity_logs (id,category,action,entity,record_id,label,metadata,created_at,updated_at) VALUES (?,'AI','create','aiConversations',?,?,?,?,?)")
          .bind(crypto.randomUUID(),id,`AI conversation started in ${page}`,JSON.stringify({ requestId: key }),timestamp,timestamp),
      ] };
    });
    const answer = await env.DB.prepare("SELECT response FROM ai_conversations WHERE id=?").bind(conversationId).first();
    if (!answer) throw new Error("Conversation unavailable");
    return NextResponse.json(answer);
  } catch (error) { return accessResponse(error); }
}
