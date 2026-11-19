"use client";

import { useEffect, useState, type FormEvent } from "react";
import { providerIssues, providerLabels, type Conversation } from "./assistant-types";
import type { Row } from "./editor-types";
import { submitCommand, workspaceJson } from "./submit-command";
import { WorkspaceDialog } from "./workspace-dialog";

type Access = { workspaceId: string; onDenied: (message: string) => void; onSaved: () => void };
type PanelProps = Access & { page: string; close: () => void; open: boolean; providerAvailable: boolean; history: Row[] };

const prompts: Record<string, string[]> = {
  Revenue: ["Forecast next month’s income", "Which invoices need follow-up?"],
  Clients: ["Which clients need attention?", "Summarise the most active client"],
  Projects: ["Show current project risks", "Suggest the next milestone"],
  "Knowledge Base": ["Summarise all branding decisions", "Find everything related to AquaFit"],
  Sprints: ["What could block this sprint?", "What should I do next?"],
};

function checkedTurn(value: unknown, expectedId?: string): Conversation {
  const data = value as Partial<Conversation> | null;
  if (!data || typeof data.id !== "string" || !data.id || (expectedId && data.id !== expectedId)
      || typeof data.response !== "string" || typeof data.prompt !== "string"
      || !Object.hasOwn(providerLabels, data.providerStatus ?? "")
      || (data.providerIssue !== null && !Object.hasOwn(providerIssues, data.providerIssue ?? ""))
      || (data.providerStatus === "pending" && typeof data.preview !== "string")) {
    throw new Error("Keystone returned an incomplete conversation.");
  }
  return data as Conversation;
}

function checkAccess(response: Response, data: { error?: string } | null, onDenied: Access["onDenied"]) {
  if (response.ok) return;
  const message = data?.error || "Keystone could not load this conversation.";
  if (response.status === 401 || response.status === 403) onDenied(message);
  throw new Error(message);
}

async function send(workspace: string, command: Record<string, unknown>, onDenied: Access["onDenied"], id?: string) {
  const { response, data } = await submitCommand(workspace, "/api/assistant", command, undefined, {
    signal: AbortSignal.timeout(35_000), validateResult: value => checkedTurn(value, id),
  });
  checkAccess(response, data, onDenied);
  return data as Conversation;
}

function ConversationResult({id, workspaceId, onSaved, onDenied}: Access & {id: string}) {
  const [turn, setTurn] = useState<Conversation | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const res = await fetch("/api/assistant?id=" + encodeURIComponent(id), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          cache: "no-store", headers: {"X-Keystone-Workspace": workspaceId},
        });
        const data = await workspaceJson(res);
        if (controller.signal.aborted) return;
        checkAccess(res, data, onDenied);
        const current = checkedTurn(data, id);
        setTurn(current);
        if (current.providerStatus !== "pending" && current.providerStatus !== "approved") setError("");
        if (revision > 0 && current.providerStatus !== "running") onSaved();
        if (current.providerStatus === "running") timer = setTimeout(load, 1500);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to retrieve the conversation.");
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, workspaceId, onDenied, onSaved, revision]);

  async function decide(action: "approve" | "decline") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      setTurn(await send(workspaceId, {action, conversationId: id}, onDenied, id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision could not be confirmed.");
    } finally { setBusy(false); refresh(value => value + 1); }
  }

  return <section aria-label="Saved answer" className="conversation-result">
    {turn ? <>
      <h3>{turn.prompt}</h3>
      <p role="status">{busy ? "Confirming your decision…" : providerLabels[turn.providerStatus]}</p>
      {turn.providerIssue && <p>{providerIssues[turn.providerIssue]}</p>}
      <div className="assistant-answer">
        <strong>{turn.providerStatus === "completed" ? "OpenAI suggestion" : turn.providerStatus === "legacy" ? "Saved answer" : "Local suggestion"}</strong>
        <p>{turn.response}</p>
      </div>
      {turn.providerStatus === "pending" && <>
        <p>Approval sends this question and the displayed record fields to OpenAI once.</p>
        <details open><summary>Data to share with OpenAI</summary>
          <pre tabIndex={0} aria-label="Question and records to share" role="region">{turn.preview}</pre>
        </details>
        <div className="conversation-decisions">
          <button className="primary-button" disabled={busy} onClick={() => decide("approve")}>Approve and send to OpenAI</button>
          <button className="secondary-button" disabled={busy} onClick={() => decide("decline")}>Decline and keep local</button>
        </div>
      </>}
      {turn.providerStatus === "approved" && <div className="conversation-decisions">
        <button className="primary-button" disabled={busy} onClick={() => decide("approve")}>Continue approved request</button>
        <button className="secondary-button" disabled={busy} onClick={() => decide("decline")}>Withdraw approval</button>
      </div>}
    </> : !error && <p role="status">Loading saved conversation…</p>}
    {error && <div role="alert"><p>{error}</p><button className="secondary-button" onClick={() => { setError(""); refresh(v => v + 1); }}>Check saved status</button></div>}
  </section>;
}

export function TranscriptDialog({id, close, ...access}: Access & { id: string; close: () => void }) {
  return <WorkspaceDialog titleId="conversation-title" className="modal editor-modal" onDismiss={close}>
    <button className="modal-close" aria-label="Close" onClick={close}>×</button>
    <h2 data-dialog-start tabIndex={-1} id="conversation-title">AI conversation</h2>
    <ConversationResult id={id} {...access}/>
  </WorkspaceDialog>;
}

export function AssistantPanel({page, open, close, providerAvailable, history, ...access}: PanelProps) {
  const [prompt, setPrompt] = useState(""), [id, setId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const suggestions = prompts[page] ?? ["What should I focus on today?", "Show current risks and opportunities"];

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const review = submitter instanceof HTMLButtonElement && submitter.value === "review";
    setBusy(true); setError(""); setId("");
    try {
      const saved = await send(access.workspaceId, {page, prompt, ...(review ? {mode:"review"} : {})}, access.onDenied);
      setId(saved.id);
      access.onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the question. Retry to check its status.");
    } finally { setBusy(false); }
  }

  return <WorkspaceDialog open={open} titleId="assistant-title" className="ai-drawer" onDismiss={close}>
    <header><div><p className="eyebrow purple">CONTEXT · {page.toUpperCase()}</p><h2 id="assistant-title" data-dialog-start tabIndex={-1}>AI Command Panel</h2></div><button aria-label="Close" onClick={close}>×</button></header>
    <p className="ai-context">Get a suggestion from your workspace records. Financial questions use your local ledger.</p>
    <div className="prompt-chips">{suggestions.map(item => <button key={item} disabled={busy} onClick={() => setPrompt(item)}>{item}</button>)}</div>
    <form onSubmit={ask}><label>Ask Founder OS<textarea value={prompt} onChange={e => setPrompt(e.target.value)} required maxLength={16000} rows={5} disabled={busy}/></label>
      <button className="primary-button" disabled={busy || !prompt.trim()}>Get local suggestion</button>
      {providerAvailable && !["Finance", "Revenue"].includes(page) && <button className="secondary-button" type="submit" value="review" disabled={busy || !prompt.trim()}>Review OpenAI request</button>}
    </form>
    {busy && <p role="status">Preparing your suggestion…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {history.length > 0 && <label className="assistant-history">Saved conversations
      <select value={id} disabled={busy} onChange={e => { setError(""); setId(e.target.value); }}>
        <option value="">Choose a conversation</option>
        {history.map(row => <option key={row.id} value={row.id}>{String(row.page)} · {String(row.prompt).slice(0, 90)}</option>)}
      </select>
    </label>}
    {id && open && <ConversationResult key={id} id={id} {...access}/>}
  </WorkspaceDialog>;
}
