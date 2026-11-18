import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnv } from "../../../db/runtime";
import { accessResponse } from "../../chatgpt-auth";
import { ensureDatabase } from "../../../db/bootstrap";

const pageTables:Record<string,string[]>={
  "Mission Control":["tasks","meetings","invoices","payments","leads","clients","projects","sprints","sprint_objectives","activity_logs"],
  Tasks:["tasks","projects","clients","sprints","sprint_objectives"],Sprints:["sprints","sprint_objectives","tasks","daily_reviews","projects"],Activity:["activity_logs","clients","projects","invoices","tasks"],
  Revenue:["invoices","payments","expenses","revenue_goals","leads","subscriptions"],Clients:["leads","clients","projects","invoices","meetings","notes"],
  Projects:["projects","tasks","milestones","time_entries","invoices"],Products:["products","services","projects"],Content:["content","projects","knowledge"],
  Finance:["invoices","payments","expenses","subscriptions","revenue_goals"],"Knowledge Base":["knowledge","notes","documents","clients","projects","meetings","invoices"],
};

async function contextFor(page:string){const env=getRuntimeEnv();const tables=Object.hasOwn(pageTables,page)?pageTables[page]:pageTables["Mission Control"];const results=await env.DB.batch(tables.map(table=>env.DB.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC LIMIT 40`)));return Object.fromEntries(tables.map((table,index)=>[table,results[index].results??[]]));}
const cash=(value:number)=>new Intl.NumberFormat("en-NZ",{style:"currency",currency:"NZD",maximumFractionDigits:0}).format(value);

function localAnalysis(page:string,prompt:string,context:Record<string,unknown>){
  const rows=(name:string)=>(context[name]??[]) as Record<string,unknown>[];
  const tasks=rows("tasks"),invoices=rows("invoices"),payments=rows("payments"),leads=rows("leads"),projects=rows("projects"),clients=rows("clients"),knowledge=rows("knowledge"),meetings=rows("meetings");
  const q=prompt.toLowerCase(),today=new Date().toISOString().slice(0,10);
  if(q.includes("invoice")||q.includes("income")||q.includes("revenue")||q.includes("forecast")){
    const paid=new Set(payments.map(x=>String(x.invoice_id)));const followUp=invoices.filter(x=>!["Paid","Void"].includes(String(x.status))&&!paid.has(String(x.id)));
    const pipeline=leads.filter(x=>!["Lost","Closed"].includes(String(x.stage))).reduce((sum,x)=>sum+Number(x.value||0)*Number(x.probability||0)/100,0);
    return `Current weighted pipeline is ${cash(pipeline)}. ${followUp.length} invoice${followUp.length===1?"":"s"} require follow-up${followUp[0]?`, starting with ${followUp[0].number}${followUp[0].due_date?` (due ${followUp[0].due_date})`:""}`:""}. A practical next-month baseline is collected recurring income plus the weighted pipeline; confirm close dates before treating it as committed revenue.`;
  }
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

export async function POST(request: NextRequest) {
  try {
    const env = getRuntimeEnv();
    const { page = "Mission Control", prompt = "What should I focus on today?" } = await request.json();
    if (typeof page !== "string" || typeof prompt !== "string") {
      return NextResponse.json({ error: "Invalid assistant request" }, { status: 400 });
    }
    await ensureDatabase();
    const context = await contextFor(page);
    let response = localAnalysis(page, prompt, context);
    if (env.OPENAI_API_KEY) {
      const result = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_MODEL ?? "gpt-5-mini",
          input: [
            { role: "system", content: `You are the Echo in Ink Founder OS intelligence layer. Answer only from supplied application data. Surface risks, opportunities and a specific next action. Never invent records. Page: ${page}. Data: ${JSON.stringify(context)}` },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (result.ok) {
        const json = await result.json() as { output_text?: string };
        if (json.output_text) response = json.output_text;
      }
    }
    const timestamp = new Date().toISOString();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_conversations (id, page, prompt, response, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(conversationId, page, prompt, response, timestamp, timestamp),
      env.DB.prepare("INSERT INTO activity_logs (id, category, action, entity, record_id, label, metadata, created_at, updated_at) VALUES (?, 'AI', 'create', 'aiConversations', ?, ?, '{}', ?, ?)")
        .bind(crypto.randomUUID(), conversationId, `AI conversation started in ${page}`, timestamp, timestamp),
    ]);
    return NextResponse.json({response});
  } catch (error) {
    return accessResponse(error);
  }
}
