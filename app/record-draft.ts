"use client";

import { useRef, useState } from "react";
import type { EditorTarget } from "./editor-types";
import type { Field } from "./record-fields";

type Values = Record<string, unknown>;
type Draft = { format: 1; values: Values; baseUpdatedAt?: string };

function* draftKeys(workspace: string, {entity, row, initial}: EditorTarget) {
  const prefix = `founder-os-draft:${workspace}:${entity}:`;
  if (row) { yield prefix + "record:" + row.id; return; }
  if (!initial) { yield prefix + "new"; return; }
  // Contextual forms originate at one objective, sprint, lead or client. Dates,
  // priorities and other suggestions can change between visits to that parent.
  const parent = ["objectiveId", "sprintId", "leadId", "clientId"].find(key => initial[key]);
  const oldKey = prefix + JSON.stringify(initial);
  if (parent) yield prefix + JSON.stringify([parent, initial[parent]]);
  yield oldKey;
  if (!parent) return;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix + "{") || key === oldKey) continue;
    try {
      const previous = JSON.parse(key.slice(prefix.length));
      const previousParent = ["objectiveId", "sprintId", "leadId", "clientId"].find(k => previous[k]);
      if (previousParent === parent && previous[parent] === initial[parent]) yield key;
    } catch { /* Ignore unrecognised legacy context keys. */ }
  }
}

export function useRecordDraft(workspace: string, target: EditorTarget, fields: Field[], defaults: () => Values) {
  const [original] = useState(() => {
    const base = defaults();
    const entries = new Map<string, string | null>();
    let key = "";
    let draft: Draft | undefined, problem = "";
    try {
      for (const candidate of draftKeys(workspace, target)) {
        if (!key) key = candidate;
        const raw = localStorage.getItem(candidate);
        if (candidate === key) entries.set(key, raw);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const values = parsed?.format === 1 ? parsed.values : parsed;
        if (!values || typeof values !== "object" || Array.isArray(values)) continue;
        const allowed: Values = {};
        for (const field of fields) {
          const value = values[field.key];
          if (field.type === "file" || (value !== null && !["string","number","boolean"].includes(typeof value))) continue;
          if (!target.row && field.options && !field.options.includes(String(value))) continue;
          allowed[field.key] = value;
        }
        draft = { format: 1, values: allowed, baseUpdatedAt: parsed.baseUpdatedAt };
        entries.set(candidate, raw);
        break;
      }
    } catch { problem = "This browser could not read the draft."; }
    return { key, entries, base, draft, problem };
  });
  const expected = useRef(original.entries);
  const baseVersion = useRef(original.draft?.baseUpdatedAt ?? target.row?.updatedAt as string | undefined);
  const [values, setValues] = useState<Values>(() => ({ ...original.base, ...original.draft?.values }));
  const [problem, setProblem] = useState(original.problem);
  const [stale, setStale] = useState(Boolean(target.row && original.draft && original.draft.baseUpdatedAt !== target.row.updatedAt));
  const [hasDraft, setHasDraft] = useState(Boolean(original.draft));
  function clear() {
    try {
      for (const [key, raw] of expected.current) {
        if (raw !== null && localStorage.getItem(key) === raw) localStorage.removeItem(key);
      }
      return true;
    } catch { return false; }
  }
  function write(next: Values, version = baseVersion.current) {
    setValues(next);
    const changed: Values = {};
    for (const field of fields) {
      if (field.type !== "file" && next[field.key] !== original.base[field.key]) changed[field.key] = next[field.key];
    }
    const dirty = Object.keys(changed).length > 0;
    setHasDraft(dirty);
    const {key} = original;
    try {
      if (localStorage.getItem(key) !== (expected.current.get(key) ?? null)) {
        setProblem("Another tab changed this draft. Your changes are only in this editor.");
        return;
      }
      if (!dirty) {
        if (!clear()) throw new Error();
        for (const source of expected.current.keys()) expected.current.set(source, null);
      } else {
        // Preserve the original suggestions for new records, including for an
        // identical retry after a lost acknowledgement. Edits store changes only.
        const persisted = target.row ? changed : Object.fromEntries(fields.filter(f => f.type !== "file").map(f => [f.key, next[f.key]]));
        const raw = JSON.stringify({ format: 1, values: persisted, baseUpdatedAt: version } satisfies Draft);
        localStorage.setItem(key, raw);
        expected.current.set(key, raw);
        for (const [legacy, loaded] of expected.current) {
          if (legacy !== key && localStorage.getItem(legacy) === loaded) {
            localStorage.removeItem(legacy);
            expected.current.delete(legacy);
          }
        }
      }
      setProblem("");
    } catch { setProblem("Draft storage is unavailable. Your changes are only in this editor."); }
  }
  function acceptVersion(version: string) {
    baseVersion.current = version;
    setStale(false);
    write(values, version);
  }
  return { values, write, clear, hasDraft, problem, stale, acceptVersion };
}
