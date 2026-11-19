"use client";

import { useState } from "react";
import { maxFileBytes, maxTextEditBytes, previewType } from "./document-types";
import type { Row } from "./editor-types";

export function DocumentLinks({ row }: { row: Row }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const url = "/api/files?id=" + encodeURIComponent(row.id);
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(url + "&version=" + encodeURIComponent(String(row.updatedAt)), { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Unable to download document");
      if (!response.headers.get("content-disposition")?.startsWith("attachment")) throw new Error("Unable to download document");
      const local = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = local; link.download = String(row.name);
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(local), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to download document"); }
    finally { setBusy(false); }
  }
  if (row.attachmentName === null) return <span>Attachment unavailable</span>;
  return <>{previewType(row.contentType, row.attachmentName ?? row.name) && <a href={url + "&open=1"} target="_blank" rel="noopener noreferrer">Open document</a>}
    <button type="button" onClick={download} disabled={busy}>{busy ? "Downloading…" : "Download"}</button>
    {error && <span role="alert">{error}</span>}</>;
}

type TextEdit = { original: string; value: string; crlf: boolean; bom: boolean };

export function DocumentAttachment({ row, onTextFile, onPick, errorMessage }: {
  row?: Row; onTextFile: (file?: File) => void; onPick: (picked: boolean) => void; errorMessage?: string;
}) {
  const [edit, setEdit] = useState<TextEdit | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [replacement, setReplacement] = useState(false);
  async function readText() {
    if (!row) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ id: row.id, open: "1", version: String(row.updatedAt) });
      const response = await fetch("/api/files?" + params, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Unable to open document");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (decoded.includes("\0")) throw new Error("Choose a UTF-8 text file to edit its contents.");
      const original = decoded.replace(/\r\n?/g, "\n");
      setEdit({ original, value: original, crlf: decoded.includes("\r\n") && !decoded.replaceAll("\r\n", "").includes("\n"),
        bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open document"); }
    finally { setLoading(false); }
  }
  function change(value: string) {
    if (!edit || !row) return;
    setEdit({ ...edit, value });
    onTextFile(value === edit.original ? undefined : new File([edit.bom ? "\uFEFF" : "", edit.crlf ? value.replaceAll("\n", "\r\n") : value],
      String(row.attachmentName ?? row.name), { type: String(row.contentType) }));
  }
  return <div>
    {row && <div className="row-actions"><DocumentLinks row={row}/></div>}
    {edit ? <><label>Document text<textarea name="documentText" rows={8} value={edit.value} onChange={e => change(e.target.value)} required
      aria-invalid={errorMessage ? true : undefined} aria-describedby={errorMessage ? "attachment-error" : undefined}/></label>
      <button type="button" onClick={() => { setEdit(null); onTextFile(undefined); }}>Cancel text edit</button></> :
      <><div className="file-drop"><label htmlFor="record-file">{row ? "Replace attachment" : <>Attachment <span aria-hidden="true">*</span></>}</label>
        <input id="record-file" type="file" name="file" required={!row} aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? "attachment-hint attachment-error" : "attachment-hint"} onChange={e => {
          const file = e.currentTarget.files?.[0];
          setReplacement(Boolean(file)); onPick(Boolean(file));
          e.currentTarget.setCustomValidity(file && (!file.size || file.size > maxFileBytes) ? "Choose a non-empty file of 25 MiB or less" : "");
        }}/><small id="attachment-hint">Choose a non-empty file up to 25 MiB.</small></div>
        {row && row.attachmentName !== null && !replacement && previewType(row.contentType, row.attachmentName ?? row.name) === "text/plain" && Number(row.size) <= maxTextEditBytes &&
          <button type="button" disabled={loading} onClick={readText}>{loading ? "Opening…" : "Edit text"}</button>}</>}
    {errorMessage && <small className="field-error" id="attachment-error">{errorMessage}</small>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}
