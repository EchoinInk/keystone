import { AccessError } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";
import { requireAtCommit } from "../../../db/commands";
import { planMutation } from "./mutation";
import { validId, invalid } from "./validation";

// clients.lead_id is the handoff. Reuse the ordinary audited client mutation
// both for onboarding a new contact and associating an existing client.
export async function convertLead(body: Record<string, unknown>, key: string) {
  if (body.entity !== "leads" || !validId(body.id) ||
      Object.keys(body).some(k => !["entity","id","action","expectedUpdatedAt","clientId"].includes(k)) ||
      (body.clientId !== undefined && !validId(body.clientId)) ||
      (body.expectedUpdatedAt !== undefined && !validId(body.expectedUpdatedAt))) invalid("Invalid lead handoff");
  const { DB } = getRuntimeEnv();
  const lead = await DB.prepare("SELECT * FROM leads WHERE id=?").bind(body.id).first();
  if (!lead) throw new AccessError(404, "Lead unavailable");
  if (lead.stage !== "Won") throw new AccessError(409, "Mark the lead Won before handing it to a client.");
  if (body.expectedUpdatedAt !== undefined && lead.updated_at !== body.expectedUpdatedAt) throw new AccessError(409, "Lead changed. Reopen it before converting.");
  const guard = requireAtCommit(key, "EXISTS(SELECT 1 FROM leads WHERE id=? AND stage='Won' AND updated_at=?)", body.id, lead.updated_at);
  const { results: clients } = await DB.prepare("SELECT id FROM clients WHERE lead_id=? LIMIT 2").bind(body.id).all();
  if (clients.length > 1 || (clients.length && body.clientId && clients[0].id !== body.clientId)) {
    throw new AccessError(409, "Review the clients already linked to this lead.");
  }
  if (clients.length) {
    const id = String(clients[0].id);
    return { result: { recordId: id, recordIds: [id] }, statements: [guard,
      requireAtCommit(key, "EXISTS(SELECT 1 FROM clients WHERE id=? AND lead_id=?)", id, body.id)] };
  }
  let command;
  if (body.clientId) {
    const client = await DB.prepare("SELECT updated_at,lead_id FROM clients WHERE id=?").bind(body.clientId).first();
    if (!client) throw new AccessError(404, "Client unavailable");
    if (client.lead_id) throw new AccessError(409, "Client already has a converted lead");
    command = { entity: "clients", action: "update", id: body.clientId, expectedUpdatedAt: client.updated_at, data: { leadId: body.id } };
  } else {
    const { name, company, email, phone, notes, tags } = lead;
    command = { entity: "clients", action: "create", data: { leadId: body.id, status: "Onboarding", name, company, email, phone, notes, tags } };
  }
  const plan = await planMutation(command, key);
  return { ...plan, statements: [guard, ...plan.statements] };
}
