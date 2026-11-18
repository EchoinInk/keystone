// Keep the request identity through network failures, reloads and lost response
// bodies. Only a digest of the intent and a random key enter session storage.
export async function submitCommand(workspace: string, path: string, command: Record<string, unknown>, file?: File) {
  if (!workspace) throw new Error("Sign in to save changes");
  const hash = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  const json = JSON.stringify(command);
  const attachment = file && [file.name, file.type, file.size, await hash(await file.arrayBuffer())];
  const intent = await hash(new TextEncoder().encode(JSON.stringify([path, json, attachment])));
  const storage = `founder-os-command:${workspace}:${intent}`;
  const key = sessionStorage.getItem(storage) ?? crypto.randomUUID();
  sessionStorage.setItem(storage, key);
  const headers = new Headers({ "Idempotency-Key": key });
  let body: BodyInit = json;
  if (file) {
    const form = new FormData();
    form.set("command", json);
    form.set("file", file);
    body = form;
  } else headers.set("content-type", "application/json");
  const response = await fetch(path, { method: "POST", headers, body });
  const data = await response.json();
  if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 409)) {
    if (sessionStorage.getItem(storage) === key) sessionStorage.removeItem(storage);
  }
  return { response, data };
}
