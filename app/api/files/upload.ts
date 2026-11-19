import { getRuntimeEnv } from "../../../db/runtime";
import { digest, requireAtCommit } from "../../../db/commands";
import { AccessError } from "../../chatgpt-auth";
import { maxFileBytes } from "../../document-types";
import { hex, stagingLifetime } from "./cleanup";

export async function uploadForm(request: Request) {
  const limit = maxFileBytes + 256 * 1024; // Multipart framing and document command.
  let size = 0;
  const large = () => new AccessError(413, "Choose a file of 25 MiB or less");
  if (Number(request.headers.get("content-length")) > limit) throw large();
  const stream = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length;
      if (size > limit) throw large();
      controller.enqueue(chunk);
    },
  }));
  try { return await new Response(stream, { headers: request.headers }).formData(); }
  catch { throw size > limit ? large() : new AccessError(400, "Invalid upload"); }
}

export async function uploadInput(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || !file.size || !file.name.trim()) throw new AccessError(400, "Choose a non-empty file");
  if (file.size > maxFileBytes) throw new AccessError(413, "Choose a file of 25 MiB or less");
  const contentType = file.type || "application/octet-stream";
  return { name: file.name, size: file.size, contentType, sha256: await digest(await file.arrayBuffer()) };
}

export async function fileFields(key: string, input: Awaited<ReturnType<typeof uploadInput>>) {
  const { workspaceId } = getRuntimeEnv();
  const objectKey = `workspaces/${workspaceId}/${await digest(new TextEncoder().encode(JSON.stringify([key, input])))}`;
  return { name: input.name, objectKey, contentType: input.contentType, size: input.size };
}

export async function stageFile(key: string, file: File, input: Awaited<ReturnType<typeof uploadInput>>) {
  const { DB, BUCKET } = getRuntimeEnv();
  const fields = await fileFields(key, input);
  const { objectKey } = fields;
  const expires = Date.now() + stagingLifetime;
  const reservation = await DB.prepare(`INSERT INTO file_transfers (object_key,state,retry_at,sha256) VALUES (?,'uploading',?,?)
    ON CONFLICT(object_key) DO UPDATE SET retry_at=excluded.retry_at WHERE state='uploading'
    RETURNING object_key`).bind(objectKey, expires, input.sha256).first();
  if (!reservation) throw new AccessError(410, "Upload expired. Choose the file and save again.");
  const result = await BUCKET.put(objectKey, file, { httpMetadata: { contentType: input.contentType }, sha256: input.sha256,
    onlyIf: { etagDoesNotMatch: "*" } });
  let etag = result?.etag;
  if (!etag) {
    const object = await BUCKET.get(objectKey);
    if (!object || (hex(object.checksums?.sha256) ?? await digest(await new Response(object.body).arrayBuffer())) !== input.sha256) {
      throw new AccessError(409, "Stored bytes differ. Select the file again.");
    }
    etag = object.etag;
  }
  return { result: fields, statements: [
    requireAtCommit(key, "EXISTS(SELECT 1 FROM file_transfers WHERE object_key=? AND state='uploading')", objectKey),
    DB.prepare("UPDATE file_transfers SET state='staged',retry_at=?,etag=? WHERE object_key=?").bind(expires, etag, objectKey),
    DB.prepare("INSERT INTO workspace_files (object_key,etag,name,content_type,size) VALUES (?,?,?,?,?)")
      .bind(objectKey, etag, input.name, input.contentType, input.size),
  ] };
}
