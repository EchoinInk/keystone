import { AccessError } from "../../chatgpt-auth";
import { reopenStatus, sprintDays, taskStatus } from "../../workflows";
import { getRuntimeEnv } from "../../../db/runtime";
import { validId, invalid } from "./validation";
import { updateRelated } from "./related";

type Row = Record<string, unknown>;
type Guard = (predicate: string, ...values: unknown[]) => void;
const terminalStages = ["Won", "Lost", "Not suitable"];

export async function prepareWorkflow(entity: string, fields: Row, existing: Row | undefined, duplicating: boolean, guard: Guard) {
  const { DB } = getRuntimeEnv();
  const row = { ...existing, ...fields };
  if (entity === "sprints") {
    if (duplicating) fields.status = "Planned";
    if ((fields.status ?? existing?.status ?? "Active") === "Active" && existing?.status !== "Active") {
      const condition = "NOT EXISTS(SELECT 1 FROM sprints WHERE status='Active' AND id<>?)";
      if (await DB.prepare("SELECT id FROM sprints WHERE status='Active' AND id<>? LIMIT 1").bind(existing?.id ?? "").first()) {
        throw new AccessError(409, "Complete or plan the active sprint before starting another.");
      }
      guard(condition, existing?.id ?? "");
    }
    if (!existing || ["startDate", "endDate", "duration"].some(k => k in fields)) {
      const days = sprintDays(String(row.startDate), String(row.endDate));
      if (!Number.isSafeInteger(days) || days < 1) invalid("Choose valid sprint dates");
      // Dates also define custom durations and are the source of truth on edits.
      if ("duration" in fields && fields.duration !== "Custom" &&
          ((typeof fields.duration !== "number" && !(typeof fields.duration === "string" && /^\d+$/.test(fields.duration))) ||
          Number(fields.duration) !== days)) {
        invalid("Sprint duration must match its start and end dates");
      }
      fields.duration = days;
    }
  }
  if (entity === "launchObjectives") {
    if (!duplicating && "taskId" in fields) invalid("Link this weekly objective from the task");
    if (duplicating) delete fields.taskId;
    if (!existing) {
      if (!duplicating && fields.status !== undefined && fields.status !== "Not started") invalid("Weekly objective status follows its tasks");
      fields.status = "Not started";
    } else if ("status" in fields) invalid("Weekly objective status follows its tasks");
  }
  if (entity === "sprintObjectives" && row.taskId) {
    if (!validId(row.taskId)) invalid("Invalid task link");
    const task = await DB.prepare("SELECT status,sprint_id,updated_at FROM tasks WHERE id=?").bind(row.taskId).first<Row>();
    if (!task) throw new AccessError(404, "Connected task unavailable");
    if (task.sprint_id && task.sprint_id !== row.sprintId) throw new AccessError(409, "Move the task to this sprint before linking it.");
    guard("EXISTS(SELECT 1 FROM tasks WHERE id=? AND updated_at=? AND (sprint_id IS NULL OR sprint_id=?))",
      row.taskId, task.updated_at, row.sprintId ?? null);
    if (!task.sprint_id) guard("NOT EXISTS(SELECT 1 FROM sprint_objectives WHERE task_id=? AND sprint_id<>? AND id<>?)",
      row.taskId, row.sprintId ?? null, existing?.id ?? "");
    const status = taskStatus(task.status);
    if (!duplicating && "status" in fields && taskStatus(fields.status) !== status) invalid("Update status on the connected task");
    fields.status = status;
  }
  if (entity === "sprintObjectives" && existing?.taskId && "taskId" in fields && !row.taskId && !("status" in fields)) {
    // An older linked row may still contain the status it had before it was
    // linked. Preserve the task's displayed status when it becomes standalone.
    const task = await DB.prepare("SELECT status,updated_at FROM tasks WHERE id=?").bind(existing.taskId).first<Row>();
    if (task) {
      fields.status = taskStatus(task.status);
      guard("EXISTS(SELECT 1 FROM tasks WHERE id=? AND updated_at=?)", existing.taskId, task.updated_at);
    }
  }
  if (entity === "leads") {
    if (!existing && fields.stage === undefined) fields.stage = "New";
    if (terminalStages.includes(String(row.stage))) {
      if ("status" in fields && fields.status !== "Closed" && !duplicating) invalid("A won, lost or unsuitable lead is closed");
      fields.status = "Closed";
    } else if (existing && fields.stage && terminalStages.includes(String(existing.stage)) && !("status" in fields)) {
      fields.status = "Open";
    }
    if (existing && fields.stage && fields.stage !== "Won" && fields.stage !== existing.stage) {
      guard("NOT EXISTS(SELECT 1 FROM clients WHERE lead_id=?)", existing.id);
    }
  }
}

export async function guardRelationships(entity: string, id: string, row: Row, existing: Row | undefined, guard: Guard) {
  const { DB } = getRuntimeEnv();
  const changed = (key: string) => row[key] !== existing?.[key];
  if (["tasks", "documents"].includes(entity) && row.projectId) {
    for (const [field, column] of [["clientId", "client_id"], ["productId", "product_id"]]) {
      if (row[field] && (changed(field) || changed("projectId"))) {
        guard(`EXISTS(SELECT 1 FROM projects WHERE id=? AND (${column} IS NULL OR ${column}=?))`, row.projectId, row[field]);
      }
    }
  }
  if (entity === "projects" && existing) {
    for (const [field, column, tables] of [["clientId","client_id",["tasks","documents"]], ["productId","product_id",["tasks"]]] as const) {
      if (row[field] && changed(field)) for (const table of tables) {
        guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE project_id=? AND ${column}<>?)`, id, row[field]);
      }
    }
  }
  if (entity === "clients" && changed("leadId")) {
    if (existing?.leadId) guard("NOT EXISTS(SELECT 1 FROM proposals WHERE lead_id=? AND client_id=?)", existing.leadId, id);
    if (row.leadId) {
      const lead = await DB.prepare("SELECT stage FROM leads WHERE id=?").bind(row.leadId).first<Row>();
      if (lead?.stage !== "Won") throw new AccessError(409, "Mark the lead Won before handing it to a client.");
      guard("EXISTS(SELECT 1 FROM leads WHERE id=? AND stage='Won')", row.leadId);
      guard("NOT EXISTS(SELECT 1 FROM proposals WHERE lead_id=? AND client_id<>?)", row.leadId, id);
      guard("NOT EXISTS(SELECT 1 FROM proposals WHERE client_id=? AND lead_id<>?)", id, row.leadId);
    }
  }
  if (entity === "proposals" && row.leadId && row.clientId && (changed("leadId") || changed("clientId"))) {
    guard("NOT EXISTS(SELECT 1 FROM clients WHERE (lead_id=? AND id<>?) OR (id=? AND lead_id<>?))",
      row.leadId, row.clientId, row.clientId, row.leadId);
  }
}

export function taskCompletion(fields: Row, existing: Row | undefined, timestamp: string) {
  if (!fields.status) return;
  const previous = taskStatus(existing?.status);
  fields.completedAt = fields.status === "Completed" ? previous === "Completed"
    ? existing?.completedAt || existing?.updatedAt || timestamp : timestamp : null;
  if (fields.status === "Completed") fields.previousStatus = previous === "Completed" ? reopenStatus(existing?.previousStatus) : previous;
  else if (fields.status !== "Cancelled") fields.previousStatus = fields.status;
}

export function relatedChanges(entity: string, row: Row, existing: Row | undefined, fields: Row, timestamp: string, key: string) {
  if (entity === "sprintObjectives" && row.taskId) {
    return updateRelated("tasks", "id=? AND sprint_id IS NULL", [row.taskId], "sprint_id=?", [row.sprintId],
      timestamp, key, "Task assigned to its daily objective’s sprint");
  }
  if (entity === "clients" && row.leadId && row.leadId !== existing?.leadId) {
    return updateRelated("proposals", "lead_id=? AND client_id IS NULL", [row.leadId], "client_id=?", [row.id],
      timestamp, key, "Proposal linked to the converted client");
  }
  if (entity !== "tasks" || !existing) return [];
  const statements = [];
  const status = taskStatus(row.status);
  if ("sprintId" in fields) {
    const moving = Boolean(row.sprintId);
    const where = moving ? "task_id=? AND (sprint_id<>? OR status<>?)" : "task_id=?";
    statements.push(...updateRelated("sprintObjectives", where, moving ? [row.id, row.sprintId, status] : [row.id],
      moving ? "sprint_id=?,status=?" : "task_id=NULL,status=?", moving ? [row.sprintId, status] : [status], timestamp, key,
      moving ? "Daily objective moved with its task" : "Daily objective detached from its task"));
  } else if ("status" in fields) {
    statements.push(...updateRelated("sprintObjectives", "task_id=? AND status<>?", [row.id, status], "status=?", [status],
      timestamp, key, "Daily objective updated from its task"));
  }
  if ("objectiveId" in fields) {
    statements.push(...updateRelated("launchObjectives", "task_id=? AND id<>?", [row.id, row.objectiveId ?? ""],
      "task_id=NULL", [], timestamp, key, "Weekly objective unlinked from its task"));
  }
  return statements;
}
