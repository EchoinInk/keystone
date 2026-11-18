import { AccessError, accessResponse } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";

import { runCommand } from "../../../db/commands";
import { uploadInput, stageFile } from "./upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => { throw new AccessError(400, "Invalid upload"); });
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
      SELECT d.name, f.object_key, f.etag FROM documents d
      JOIN workspace_files f ON f.object_key = d.object_key
      WHERE ${id ? "d.id" : "d.object_key"} = ? LIMIT 1
    `).bind(id || key).first<{ name: string; object_key: string; etag: string }>();
    if (!file) throw new AccessError(404, "Document unavailable");

    const object = await env.BUCKET.get(file.object_key);
    if (!object || object.etag !== file.etag) throw new AccessError(404, "Document unavailable");
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "document";
    return new Response(object.body, { headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, no-store",
    } });
  } catch (error) {
    return accessResponse(error);
  }
}
