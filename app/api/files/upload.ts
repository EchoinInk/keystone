import { getRuntimeEnv } from "../../../db/runtime";
import { digest } from "../../../db/commands";
import { AccessError } from "../../chatgpt-auth";

export async function uploadInput(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || !file.size || !file.name.trim()) throw new AccessError(400, "Choose a non-empty file");
  if (file.size > 25 * 1024 * 1024) throw new AccessError(413, "Choose a file of 25 MiB or less");
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
  // Content-address each attempt. A retry repairs a lost registry commit with
  // the same bytes and key. Downloads require both registration and a document.
  const result = await BUCKET.put(objectKey, file, { httpMetadata: { contentType: input.contentType }, onlyIf: { etagDoesNotMatch: "*" } });
  const object = result ?? await BUCKET.get(objectKey);
  if (!object) throw new Error("Upload unavailable");
  return {
    result: fields,
    statements: [DB.prepare("INSERT INTO workspace_files (object_key,etag,name,content_type,size) VALUES (?,?,?,?,?)")
      .bind(objectKey, object.etag, input.name, input.contentType, input.size)],
  };
}
