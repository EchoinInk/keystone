import { getRuntimeEnv } from "../../../db/runtime";

const batchSize = 8;
export const stagingLifetime = 24 * 60 * 60 * 1000;
type Transfer = { object_key: string; etag: string | null; sha256: string | null };

export function hex(bytes?: ArrayBuffer) {
  return bytes && Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function pendingFileCleanup() {
  const { DB, workspaceId } = getRuntimeEnv();
  const pending = await DB.prepare("SELECT count(*) AS n FROM file_transfers WHERE state='retired' AND instr(object_key, ?) = 1")
    .bind(`workspaces/${workspaceId}/`).first<{ n: number }>();
  return Number(pending?.n ?? 0);
}

export async function cleanFiles(scan?: { cursor?: string }) {
  const { DB, BUCKET, workspaceId } = getRuntimeEnv();
  const prefix = `workspaces/${workspaceId}/`;
  let nextCursor: string | null = null;
  if (scan) {
    // A stopped uploader can finish its R2 put after its reservation expired.
    // Revisit only tombstones for objects actually seen on this bounded page.
    const page = await BUCKET.list({ prefix, limit: 32, cursor: scan.cursor });
    nextCursor = page.truncated ? page.cursor ?? null : null;
    if (page.objects.length) await DB.prepare(`UPDATE file_transfers SET state='retired',retry_at=0
      WHERE state='purged' AND object_key IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(page.objects.map(item => item.key))).run();
  }
  const now = Date.now();
  const due = "instr(object_key, ?) = 1 AND retry_at<=?";
  const unlinked = "NOT EXISTS(SELECT 1 FROM documents d WHERE d.object_key=file_transfers.object_key)";
  // Claim expiry in D1 before touching R2. A concurrent attach or retry either
  // wins the transaction or sees a permanently retired key.
  await DB.batch([
    DB.prepare(`UPDATE file_transfers SET state='retired',retry_at=0 WHERE object_key IN
      (SELECT object_key FROM file_transfers WHERE ${due} AND state IN ('uploading','staged') AND ${unlinked}
       ORDER BY retry_at,object_key LIMIT ?)`).bind(prefix, now, batchSize),
    DB.prepare(`DELETE FROM workspace_files WHERE object_key IN
      (SELECT object_key FROM file_transfers WHERE ${due} AND state='retired' AND ${unlinked} ORDER BY retry_at,object_key LIMIT ?)`)
      .bind(prefix, now, batchSize),
  ]);
  const jobs = await DB.prepare(`SELECT object_key,etag,sha256 FROM file_transfers WHERE ${due} AND state='retired'
    AND ${unlinked} AND NOT EXISTS(SELECT 1 FROM workspace_files f WHERE f.object_key=file_transfers.object_key)
    ORDER BY retry_at,object_key LIMIT ?`).bind(prefix, now, batchSize).all<Transfer>();
  let purged = 0;
  for (const job of jobs.results) {
    const key = job.object_key;
    try {
      if (!/^[0-9a-f]{64}$/.test(key.slice(prefix.length))) throw new Error("Unmanaged key");
      const object = await BUCKET.head(key);
      if (object) {
        const matches = job.etag ? job.etag === object.etag : job.sha256 && job.sha256 === hex(object.checksums?.sha256);
        if (!matches) throw new Error("Object version has changed");
        await BUCKET.delete(key);
      }
      await DB.prepare("UPDATE file_transfers SET state='purged' WHERE object_key=? AND state='retired'").bind(key).run();
      purged++;
    } catch {
      // Leave a durable retry after a temporary failure or a version mismatch.
      await DB.prepare("UPDATE file_transfers SET retry_at=? WHERE object_key=? AND state='retired'").bind(now + 60000, key).run();
    }
  }
  const remaining = await DB.prepare(`SELECT 1 FROM file_transfers WHERE ${due} AND state IN ('uploading','staged','retired')
    AND ${unlinked} LIMIT 1`).bind(prefix, now).first();
  return { purged, pending: await pendingFileCleanup(), moreDue: Boolean(remaining), nextCursor };
}
