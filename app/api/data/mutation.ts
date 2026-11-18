import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getRuntimeEnv } from "../../../db/runtime";
import { isRecord, requireAtCommit } from "../../../db/commands";
import { AccessError } from "../../chatgpt-auth";
import { cents } from "../../finance";
import { configs } from "../../record-fields";
import { entities, mapRow, snake } from "./entities";
import { invalid, validateFields, validId } from "./validation";

type Row = Record<string, unknown>;
const history = ["revisions", "activityLogs", "aiConversations"];
const ownership = /^(?:workspace|owner|user|tenant|principal|subject)(?:_?id)?$/i;
const receiptSum = "COALESCE((SELECT SUM(CAST(ROUND(amount*100) AS INTEGER)) FROM payments WHERE invoice_id=? AND id<>?),0)";

function nextTimestamp(previous?: unknown) {
  const last = Date.parse(String(previous));
  return new Date(Number.isFinite(last) ? Math.max(Date.now(), last + 1) : Date.now()).toISOString();
}

function parseMutation(body: Row) {
  const entity = body.entity;
  if (typeof entity !== "string" || !Object.hasOwn(entities, entity)) throw new AccessError(400, "Unknown data model");
  if (history.includes(entity)) throw new AccessError(403, "History is read-only");
  if (body.data !== undefined && !isRecord(body.data)) invalid("Expected record fields");
  const fields: Row = { ...(body.data as Row | undefined) };
  if ([...Object.keys(body), ...Object.keys(fields)].some(k => ownership.test(k))) throw new AccessError(403, "Ownership is managed by the server");
  const action = body.action === undefined ? "create" : body.action;
  const bulk = action === "bulkDelete", deleting = action === "delete" || bulk, creating = action === "create" || action === "duplicate";
  if (!creating && !deleting && action !== "update") invalid("Unknown action");
  const allowed = ["action", "entity", ...(bulk ? ["ids"] : action === "create" ? [] : ["id", "expectedUpdatedAt"]),
    ...(action === "create" || action === "update" ? ["data"] : [])];
  if (Object.keys(body).some(k => !allowed.includes(k))) invalid("Unexpected command field");
  if (body.expectedUpdatedAt !== undefined && !validId(body.expectedUpdatedAt)) invalid("Invalid record version");
  const selectionInput = bulk ? body.ids : action === "create" ? [] : [body.id];
  if (!Array.isArray(selectionInput) || (bulk && !selectionInput.length) || selectionInput.length > 50
      || !selectionInput.every(validId) || new Set(selectionInput).size !== selectionInput.length) throw new AccessError(400, "Invalid record selection");
  const ids: string[] = selectionInput;
  return { entity, action: String(action), fields, ids, creating, deleting };
}

function guardFinancialRecord(entity: string, recordId: string, row: Row, existing: Row | undefined,
  guard: (predicate: string, ...values: unknown[]) => void) {
  if (entity === "invoices") {
    guard("NOT EXISTS(SELECT 1 FROM invoices WHERE lower(trim(number))=lower(trim(?)) AND id<>?)", row.number, recordId);
    const gross = cents(row.amount) + cents(row.tax);
    if (!Number.isSafeInteger(gross)) invalid("Invoice total exceeds currency precision");
    guard(`${receiptSum} <= ?`, recordId, "", gross);
    if (row.status === "Void") guard("NOT EXISTS(SELECT 1 FROM payments WHERE invoice_id=?)", recordId);
    if (["Paid", "Part paid"].includes(String(row.status)) && row.status !== existing?.status) {
      invalid("Settlement is calculated from receipts");
    }
  }
  if (entity === "payments") {
    guard(`EXISTS(SELECT 1 FROM invoices WHERE id=? AND status<>'Void'
      AND ROUND(amount*100)+ROUND(tax*100) >= ? + ${receiptSum})`, row.invoiceId, cents(row.amount), row.invoiceId, recordId);
    if (String(row.reference ?? "").trim()) guard("NOT EXISTS(SELECT 1 FROM payments WHERE invoice_id=? AND lower(trim(reference))=lower(trim(?)) AND id<>?)", row.invoiceId, row.reference, recordId);
  }
}

export async function planMutation(body: Row, key: string, attachment?: Row) {
  const { DB } = getRuntimeEnv();
  const { entity, action, fields, ids, creating, deleting } = parseMutation(body);
  if (attachment && (entity !== "documents" || (action !== "create" && action !== "update"))) invalid("Invalid attachment command");
  const { table, columns, category } = entities[entity];
  const statements: D1PreparedStatement[] = [];
  const guard = (predicate: string, ...values: unknown[]) => statements.push(requireAtCommit(key, predicate, ...values));
  const selection = JSON.stringify(ids);
  const selectedIds = "SELECT value FROM json_each(?)";
  const records: Row[] = [];
  if (ids.length) {
    const selected = await DB.prepare(`SELECT * FROM ${table} WHERE id IN (${selectedIds})`).bind(selection).all<Row>();
    const byId = new Map(selected.results.map(raw => [raw.id, mapRow(raw)]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) throw new AccessError(404, "Record not found");
      if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== row.updatedAt) {
        throw new AccessError(409, "Record changed. Reopen it before saving.");
      }
      records.push(row);
    }
    const versions = records.map(row => [row.id, row.updatedAt]);
    guard(`(SELECT count(*) FROM ${table} r JOIN json_each(?) v
      ON r.id=json_extract(v.value,'$[0]') AND r.updated_at=json_extract(v.value,'$[1]'))=?`,
      JSON.stringify(versions), records.length);
  }
  const existing = records[0];
  const timestamp = nextTimestamp(existing?.updatedAt);
  const recordId = creating ? crypto.randomUUID() : String(existing.id);
  function audit(id: string, row: Row, revision: string) {
    // Capture database defaults on insert and exact before-images otherwise.
    const snapshot = creating
      ? `(SELECT json_object(${["id", ...columns, "createdAt", "updatedAt"].map(k => `'${k}',${snake(k)}`).join(",")}) FROM ${table} WHERE id=?)` : "?";
    statements.push(DB.prepare(`INSERT INTO revisions (id,entity,record_id,action,snapshot,created_at,updated_at) VALUES (?,?,?,?,${snapshot},?,?)`)
      .bind(crypto.randomUUID(), entity, id, revision, creating ? id : JSON.stringify(row), timestamp, timestamp));
    const labelRow = action === "update" ? { ...row, ...fields } : row;
    const name = labelRow.name ?? labelRow.title ?? labelRow.number ?? labelRow.description ?? entity;
    const verbs: Record<string, string> = { create: "created", update: "updated", duplicate: "duplicated", delete: "deleted", bulkDelete: "deleted" };
    const label = entity === "tasks" && action === "update" && fields.status
      ? `${name} moved to ${fields.status}` : `${name} ${verbs[action]}`;
    statements.push(DB.prepare("INSERT INTO activity_logs (id,category,action,entity,record_id,label,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), category, action, entity, id, label, JSON.stringify({ source: "Founder OS", requestId: key }), timestamp, timestamp));
  }

  if (deleting) {
    // Some historical relations have no physical foreign key. Check inbound
    // references inside the same transaction as deletion, including polymorphic links.
    for (const [child, specs] of Object.entries(configs)) {
      for (const field of specs.filter(f => f.relation === entity)) {
        guard(`NOT EXISTS(SELECT 1 FROM ${entities[child].table} WHERE ${snake(field.key)} IN (${selectedIds}))`, selection);
      }
    }
    if (entity === "tasks") guard(`NOT EXISTS(SELECT 1 FROM launch_objectives WHERE task_id IN (${selectedIds}))`, selection);
    guard(`NOT EXISTS(SELECT 1 FROM calendar_events WHERE related_type=? AND related_id IN (${selectedIds}))`, entity, selection);
    for (const row of records) audit(String(row.id), row, "delete");
    statements.push(DB.prepare(`DELETE FROM ${table} WHERE id IN (${selectedIds})`).bind(selection));
  } else {
    if (action === "duplicate") {
      if (["invoices", "payments", "revenueGoals"].includes(entity)) invalid("Enter a new financial record with its own details");
      for (const column of columns) fields[column] = existing[column];
      for (const k of ["name", "title"]) if (fields[k]) fields[k] += " copy";
      if (entity === "tasks") Object.assign(fields, { status: "To do", previousStatus: "To do", completedAt: null });
    }
    if (entity === "leads" && creating && fields.stage === undefined) fields.stage = "New";
    if (["tasks", "sprintObjectives"].includes(entity)) {
      if (creating && fields.status === undefined) fields.status = "To do";
      if (fields.status === "Todo") fields.status = "To do";
      if (fields.status === "Done") fields.status = "Completed";
    }
    if (entity === "tasks" && action !== "duplicate" && ("previousStatus" in fields || "completedAt" in fields)) invalid("Task completion history is server-managed");
    if (attachment) {
      if ("objectKey" in fields) invalid("Invalid attachment command");
      Object.assign(fields, attachment);
    } else if (entity === "documents" && (creating || "objectKey" in fields)) {
      if (!validId(fields.objectKey)) invalid("Choose a file");
      const file = await DB.prepare("SELECT name,content_type,size FROM workspace_files WHERE object_key=?").bind(fields.objectKey).first<Row>();
      if (!file) throw new AccessError(404, "Document unavailable");
      fields.name ??= file.name;
      fields.contentType = file.content_type;
      fields.size = file.size;
    } else if (entity === "documents" && ("contentType" in fields || "size" in fields)) invalid("File metadata is server-managed");
    if (!Object.keys(fields).length) invalid("Missing record fields");
    validateFields(entity, fields, creating ? undefined : existing);
    if (entity === "tasks" && fields.status) {
      fields.completedAt = fields.status === "Completed" ? (existing?.status === "Completed" && existing.completedAt || timestamp) : null;
      if (fields.status === "Completed") fields.previousStatus = existing?.status === "Completed" ? existing.previousStatus : existing?.status ?? "To do";
      else if (fields.status !== "Cancelled") fields.previousStatus = fields.status;
    }
    const row = { ...(creating ? {} : existing), ...fields };
    for (const column of columns.filter(k => k.endsWith("Id"))) {
      const value = row[column];
      if (!value || (!creating && existing[column] === value && (column !== "relatedId" || row.relatedType === existing.relatedType))) continue;
      const model = column === "relatedId" ? String(row.relatedType) : column === "taskId" ? "tasks" : configs[entity]?.find(f => f.key === column)?.relation;
      if (!model || !Object.hasOwn(entities, model) || !validId(value)) throw new AccessError(400, "Invalid record link");
      const query = `SELECT id FROM ${entities[model].table} WHERE id=?`;
      if (!await DB.prepare(query).bind(value).first()) throw new AccessError(404, "Linked record unavailable");
      guard(`EXISTS(${query})`, value);
    }
    guardFinancialRecord(entity, recordId, row, creating ? undefined : existing, guard);
    if (entity === "clients" && row.leadId) guard("NOT EXISTS(SELECT 1 FROM clients WHERE lead_id=? AND id<>?)", row.leadId, recordId);
    if (entity === "revenueGoals") guard("NOT EXISTS(SELECT 1 FROM revenue_goals WHERE period=? AND id<>?)", row.period, recordId);
    const keys = Object.keys(fields), values = Object.values(fields);
    if (creating) {
      const names = ["id", ...keys.map(snake), "created_at", "updated_at"];
      statements.push(DB.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?")})`)
        .bind(recordId, ...values, timestamp, timestamp));
    } else {
      statements.push(DB.prepare(`UPDATE ${table} SET ${keys.map(k => snake(k) + "=?")},updated_at=? WHERE id=?`).bind(...values, timestamp, recordId));
    }
    audit(recordId, creating ? row : existing, creating ? "create" : "update");
  }

  // Existing workspaces can carry explicit settlement labels. A ledger edit
  // must not create a new contradiction. The founder can review the original
  // status and explicitly change the workflow label in a separate audited edit.
  if (entity === "invoices" || entity === "payments") {
    const invoiceIds = entity === "invoices" ? [recordId] : [...records.map(row => row.invoiceId), fields.invoiceId];
    for (const invoice of new Set(invoiceIds.filter(Boolean))) {
      guard(`NOT EXISTS(SELECT 1 FROM (
        SELECT status, ROUND(amount*100)+ROUND(tax*100) AS gross,
          (SELECT COALESCE(SUM(ROUND(p.amount*100)),0) FROM payments p WHERE p.invoice_id=i.id) AS paid
        FROM invoices i WHERE i.id=? AND status IN ('Paid','Part paid')
      ) WHERE (status='Paid' AND (paid<=0 OR paid<gross))
        OR (status='Part paid' AND (paid<=0 OR paid>=gross)))`, invoice);
    }
  }

  if (entity === "tasks") {
    const objectives = new Set([...records.map(r => r.objectiveId), fields.objectiveId].filter(Boolean));
    for (const objective of objectives) {
      const status = `(SELECT CASE WHEN count(*)=0 THEN 'Not started' WHEN min(status='Completed') THEN 'Completed'
        WHEN max(status='Blocked') THEN 'Blocked' WHEN max(status IN ('In progress','In review','Completed')) THEN 'In progress'
        ELSE 'Not started' END FROM tasks WHERE objective_id=launch_objectives.id AND status<>'Cancelled')`;
      statements.push(DB.prepare(`UPDATE launch_objectives SET status=${status},
        updated_at=CASE WHEN updated_at>=? AND julianday(updated_at) IS NOT NULL
          THEN strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds') ELSE ? END
        WHERE id=? AND status<>${status}`).bind(timestamp, timestamp, objective));
    }
  }
  return { result: { recordId, recordIds: deleting ? records.map(row => row.id) : [recordId] }, statements };
}
