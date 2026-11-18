import { AccessError, accessResponse } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const env = getRuntimeEnv();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AccessError(400, "Choose a file");

    // The dedicated database is the authority for object ownership. Neither
    // user-supplied keys nor an R2 listing can populate its file registry.
    const objectKey = `workspaces/${env.workspaceId}/${crypto.randomUUID()}`;
    const contentType = file.type || "application/octet-stream";
    const object = await env.BUCKET.put(objectKey, file, { httpMetadata: { contentType } });
    if (!object) throw new Error("Upload unavailable");
    await env.DB.prepare(
      "INSERT INTO workspace_files (object_key, etag, name, content_type, size) VALUES (?, ?, ?, ?, ?)",
    ).bind(objectKey, object.etag, file.name, contentType, file.size).run();
    return Response.json({ name: file.name, objectKey, contentType, size: file.size });
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
