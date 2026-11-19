"use client";

import { useState } from "react";
import type { DataSet, EditorTarget, Row, Save } from "./editor-types";

export function HandoffControls({ entity, row, data, open, save, disabled }: {
  entity: string; row: Row; data: DataSet; open: (target: EditorTarget) => void; save: Save; disabled: boolean;
}) {
  const [selected, setSelected] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const isLead = entity === "leads";
  const lead = isLead ? row : data.leads.find(item => item.id === row.leadId);
  const clients = isLead ? data.clients.filter(item => item.leadId === row.id) : [row];
  const client = clients.length === 1 ? clients[0] : undefined;
  async function convert() {
    setBusy(true); setError("");
    try {
      await save("leads", "convert", { id: row.id, expectedUpdatedAt: row.updatedAt, ...(selected ? { clientId: selected } : {}) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to convert lead"); }
    finally { setBusy(false); }
  }
  const projects = client ? data.projects.filter(project => project.clientId === client.id) : [];
  const proposals = data.proposals.filter(proposal => (lead && proposal.leadId === lead.id) || (client && proposal.clientId === client.id));
  return <fieldset disabled={disabled || busy} className="revision-history"><legend>Client handoff</legend>
    {isLead && !client && row.stage === "Won" && <><label>Convert to client<select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">New onboarding client</option>
      {data.clients.filter(item => !item.leadId).map(item => <option value={item.id} key={item.id}>{String(item.name)}</option>)}
    </select></label><button type="button" onClick={convert}>{busy ? "Converting…" : "Convert lead"}</button></>}
    {isLead && clients.map(item => <button key={item.id} onClick={() => open({ entity: "clients", row: item })}>Open client · {String(item.name)}</button>)}
    {!isLead && lead && <button onClick={() => open({ entity: "leads", row: lead })}>Open lead · {String(lead.name)}</button>}
    {proposals.map(item => <button key={item.id} onClick={() => open({ entity: "proposals", row: item })}>Open proposal · {String(item.title)}</button>)}
    <button onClick={() => open({ entity: "proposals", initial: { leadId: lead?.id ?? "", clientId: client?.id ?? "" } })}>Add proposal</button>
    {projects.map(item => <button key={item.id} onClick={() => open({ entity: "projects", row: item })}>Open project · {String(item.name)}</button>)}
    {client && <button onClick={() => open({ entity: "projects", initial: { clientId: client.id } })}>Add project</button>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </fieldset>;
}
