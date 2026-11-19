import { getRuntimeEnv } from "../../../db/runtime";
import { financialReport, pipelineMetrics } from "../../finance";

// Shared fields are selected on the server. Knowledge Base questions can also
// include a short, reviewable excerpt from each relevant knowledge record.
const sharedFields = {
  tasks: ["title", "status", "priority", "due_date"],
  projects: ["name", "status", "due_date", "progress"],
  clients: ["company", "status", "updated_at"],
  meetings: ["title", "starts_at", "status"],
  leads: ["stage", "status", "follow_up_date"],
  sprints: ["name", "start_date", "end_date", "status"],
  sprint_objectives: ["title", "due_date", "status"],
  daily_reviews: ["date"],
  activity_logs: ["category", "action", "entity"],
  milestones: ["title", "due_date", "status"],
  time_entries: ["date", "minutes"],
  products: ["name", "status", "progress"],
  services: ["name", "category", "status"],
  content: ["title", "platform", "status", "publish_at"],
  knowledge: ["title", "category", "tags"],
  notes: ["title", "tags"],
  documents: ["name", "content_type"],
  launch_objectives: ["title", "status", "priority", "week_number"],
  launch_phases: ["name", "status", "target_date"],
} satisfies Record<string, string[]>;

type Table = keyof typeof sharedFields;
const pageTables: Record<string, Table[]> = {
  "Mission Control": ["tasks", "meetings", "leads", "clients", "projects", "sprints", "sprint_objectives", "activity_logs"],
  "Freelance Launch": ["launch_objectives", "launch_phases", "tasks", "leads"],
  Tasks: ["tasks", "projects", "clients", "sprints", "sprint_objectives"],
  Sprints: ["sprints", "sprint_objectives", "tasks", "daily_reviews", "projects"],
  Activity: ["activity_logs", "clients", "projects", "tasks"],
  Clients: ["leads", "clients", "projects", "meetings", "notes"],
  Projects: ["projects", "tasks", "milestones", "time_entries"],
  Products: ["products", "services", "projects"],
  Content: ["content", "projects", "knowledge"],
  "Knowledge Base": ["knowledge", "notes", "documents", "clients", "projects", "meetings"],
  Revenue: [], Finance: [],
};

export function isAssistantPage(page: unknown): page is string {
  return typeof page === "string" && Object.hasOwn(pageTables, page);
}

export async function prepareAdvice(page: string, prompt: string, review: boolean) {
  if (["Finance", "Revenue"].includes(page) || /invoic|income|revenue|forecast|receipt|payment|balance|outstanding|cash|expense|profit|settle|pipeline/i.test(prompt)) {
    return { response: await financialAdvice(), preview: null };
  }
  const { DB } = getRuntimeEnv();
  const tables = pageTables[page];
  const results = await DB.batch<Record<string, unknown>>(tables.map(table => {
    const columns = [...sharedFields[table]];
    if (table === "knowledge") columns.push("body", "links");
    if (table === "clients") columns.push("name");
    return DB.prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY updated_at DESC,id LIMIT 40`);
  }));
  const context = Object.fromEntries(tables.map((table, i) => [table, results[i].results]));
  const response = localAnalysis(page, prompt, context);
  if (!review) return { response, preview: null };
  const records = Object.fromEntries(tables.map(table => {
    const rows = context[table];
    const relevant = table === "knowledge" && page === "Knowledge Base" ? matchingKnowledge(rows, prompt) : [];
    const sample = (relevant.length ? relevant : rows).slice(0, 5).map(row => {
      const fields = Object.fromEntries(sharedFields[table].map(field => {
        const value = row[field];
        return [field, typeof value === "string" ? value.slice(0, 100) : value];
      }));
      if (table === "clients" && !fields.company) fields.name = String(row.name).slice(0, 100);
      if (table === "knowledge" && page === "Knowledge Base") fields.excerpt = String(row.body).slice(0, 300);
      return fields;
    });
    return [table, sample];
  }));
  return { response, preview: JSON.stringify({page, question: prompt, records}, null, 2) };
}

type ContextRow = Record<string, unknown>;

function matchingKnowledge(rows: ContextRow[], prompt: string) {
  const terms = prompt.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  return rows.filter(row => terms.some(term => JSON.stringify(row).toLowerCase().includes(term)));
}

const cash = (value: number) => new Intl.NumberFormat("en-NZ", {
  style: "currency", currency: "NZD", maximumFractionDigits: 2,
}).format(value);

function localAnalysis(page: string, prompt: string, context: Record<string, ContextRow[]>) {
  const {tasks = [], projects = [], clients = [], knowledge = [], meetings = []} = context;
  const q = prompt.toLowerCase(), now = new Date().toISOString(), today = now.slice(0, 10);
  if (q.includes("client") || q.includes("attention")) {
    if (!clients.length) return "There are no client records in this page sample. Open Clients to review client activity.";
    const stale = clients.filter(client => !(Date.now() - Date.parse(String(client.updated_at)) < 14 * 86_400_000));
    if (stale.length) {
      return `${stale.length} client${stale.length === 1 ? " has" : "s have"} had no recorded update in the last 14 days. Start with ${stale[0].company || stale[0].name} and log a next action after contact.`;
    }
    return `All ${clients.length} clients in this sample have recent activity. Review the highest-value open lead and turn its next action into a dated task.`;
  }
  if (q.includes("risk") || q.includes("completion") || page === "Projects") {
    const late = projects.filter(row => row.due_date && String(row.due_date) < today && !["Complete", "Completed", "Cancelled"].includes(String(row.status)));
    const blocked = tasks.filter(row => row.status === "Blocked");
    const next = late[0] ? `Review ${late[0].name} first.` : blocked[0] ? `Unblock “${blocked[0].title}” first.` : "Review the next milestone.";
    return `In this page sample, ${late.length} projects are past their due date and ${blocked.length} tasks are blocked. ${next} Estimate completion from completed linked tasks.`;
  }
  if (/knowledge|document|branding|aquafit/.test(q) || page === "Knowledge Base") {
    const matches = matchingKnowledge(knowledge, prompt);
    if (matches.length) return `I found ${matches.length} matching knowledge records, including ${matches.slice(0, 5).map(row => row.title).join(", ")}. Open them to review their links, tags and revision history.`;
    return "No knowledge record in this sample clearly matches that question. Review the source notes, documents or meetings in the Knowledge Base.";
  }
  if (page === "Freelance Launch") {
    const next = context.launch_objectives.find(row => !["Completed", "Cancelled"].includes(String(row.status)));
    if (next) return `Review the launch objective “${next.title}” and its linked tasks to choose your next step.`;
  }
  const open = tasks.filter(row => !["Completed", "Done", "Cancelled"].includes(String(row.status)))
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  const nextMeeting = meetings.filter(row => String(row.starts_at) >= now)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  const task = open[0];
  const next = task ? `“${task.title}”${task.due_date ? ` (due ${task.due_date})` : ""}` : "to create one dated, high-value task";
  return `${open.length} open task${open.length === 1 ? "" : "s"} in scope. Your suggested next action is ${next}.${nextMeeting ? ` Your next meeting is “${nextMeeting.title}”.` : ""} This uses up to 40 recent records per collection in ${page}.`;
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
