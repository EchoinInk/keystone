import { AccessError, accessResponse } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";

import { runCommand } from "../../../db/commands";
import { previewType } from "../../document-types";
import { cleanFiles } from "./cleanup";
import { uploadForm, uploadInput, stageFile } from "./upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("cleanup") === "1") {
      const cursor = params.get("cursor") || undefined;
      if (cursor && cursor.length > 2048) throw new AccessError(400, "Invalid cleanup cursor");
      const result = await runCommand(request, { cleanup: true, cursor }, async () => ({
        result: await cleanFiles({ cursor }), statements: [],
      }));
      return Response.json(result);
    }
    const form = await uploadForm(request);
    const file = form.get("file");
    const input = await uploadInput(file);
    const result = await runCommand(request, input, key => stageFile(key, file as File, input));
    return Response.json(result);
  } catch (error) {
    return accessResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const env = getRuntimeEnv();
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const key = params.get("key"); // Existing owner links continue to resolve.
    if (!id && !key) throw new AccessError(400, "Missing document");
    const file = await env.DB.prepare(`
      SELECT d.name, d.updated_at, f.name AS attachment_name, f.content_type, f.object_key, f.etag FROM documents d
      JOIN workspace_files f ON f.object_key = d.object_key
      WHERE ${id ? "d.id" : "d.object_key"} = ? LIMIT 1
    `).bind(id || key).first<{ name: string; updated_at: string; attachment_name: string; content_type: string; object_key: string; etag: string }>();
    if (!file) throw new AccessError(404, "Document unavailable");

    if (params.has("version") && params.get("version") !== file.updated_at) throw new AccessError(409, "Document changed. Reopen it before editing.");
    const inline = params.get("open") === "1" && previewType(file.content_type, file.attachment_name);
    const object = await env.BUCKET.get(file.object_key);
    if (!object || object.etag !== file.etag) throw new AccessError(404, "Document unavailable");
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "document";
    return new Response(object.body, { headers: {
      "content-type": inline === "text/plain" ? "text/plain; charset=utf-8" : inline || "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(file.name.replace(/[/\\]/g, "_")).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, no-store",
    } });
  } catch (error) {
    return accessResponse(error);
  }
}
