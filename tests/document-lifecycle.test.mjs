import assert from "node:assert/strict";
import test from "node:test";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fixture, bindWorkspace, call } from "./fixtures/workspace.mjs";

function documents(subject) {
  const { env, sql, objects, counts } = fixture(subject);
  const user = env.FOUNDER_USER_ID;
  const upload = (command, file, key, caller=user) => {
    const form = new FormData();
    form.set("file",file);
    if (command) form.set("command",JSON.stringify({entity:"documents",...command}));
    return call(env,command?"/api/data":"/api/files",{user:caller,form,headers:{"Idempotency-Key":key}});
  };
  const read = (id, query="", caller=user) => call(env,"/api/files?id="+encodeURIComponent(id)+query,{user:caller});
  const mutate = (command, key=crypto.randomUUID(), caller=user) => call(env,"/api/data",{
    user:caller,json:{entity:"documents",...command},headers:{"Idempotency-Key":key},
  });
  const sweep = (caller=user) => call(env,"/api/files?cleanup=1",{user:caller,method:"POST"});
  return { env,sql,objects,counts,user,upload,read,mutate,sweep };
}
const file = (text="Original",name="draft.md",type="text/markdown") => new File([text],name,{type});
async function ok(response) {
  const reply = await response;
  const body = await reply.json(); assert.equal(reply.status,200,JSON.stringify(body.error)); return body;
}

test("owner can open, rename, replace and revoke a shared document with stale and denied edits rejected", async () => {
  const a = documents(), b = documents("second-workspace");
  const created = await ok(a.upload({data:{name:"Founder notes.md"}},file(),"upload"));
  const original = created.data.documents[0], id = original.id;
  const inline = await a.read(id,"&open=1");
  assert.match(inline.headers.get("content-type"),/^text\/plain/);
  assert.match(inline.headers.get("content-disposition"),/^inline/);
  assert.equal(inline.headers.get("content-security-policy"),"sandbox");
  assert.equal(await inline.text(),"Original");
  assert.equal((await b.read(id)).status,404);
  for (const caller of [null,"unadmitted"]) {
    const expected = caller ? 403 : 401;
    assert.equal((await a.read(id,"&open=1",caller)).status,expected);
    assert.equal((await a.upload({data:{}},file(),"bad",caller)).status,expected);
    assert.equal((await a.mutate({action:"update",id,data:{name:"other"}},"denied-edit",caller)).status,expected);
    assert.equal((await a.mutate({action:"delete",id},"denied-delete",caller)).status,expected);
    assert.equal((await a.sweep(caller)).status,expected);
  }
  const copy = (await ok(a.mutate({action:"duplicate",id}))).recordId;
  const renamed = await ok(a.mutate({action:"update",id,expectedUpdatedAt:original.updatedAt,data:{name:"Reviewed.md"}}));
  assert.equal(renamed.data.documents.find(r=>r.id===id).objectKey,original.objectKey);
  assert.equal(a.counts.writes,1);
  assert.equal((await a.read(id,"&open=1&version="+encodeURIComponent(original.updatedAt))).status,409);
  assert.equal((await a.upload({action:"update",id,expectedUpdatedAt:original.updatedAt,data:{}},file("Old edit"),"stale")).status,409);
  assert.equal(a.objects.size,1);
  const edited = await ok(a.upload({action:"update",id,expectedUpdatedAt:renamed.data.documents.find(r=>r.id===id).updatedAt,
    data:{}},file("New bytes","replacement.txt","text/plain"),"replace"));
  assert.equal(edited.data.documents.find(r=>r.id===id).name,"Reviewed.md");
  assert.equal(await (await a.read(id)).text(),"New bytes");
  assert.equal(await (await a.read(copy)).text(),"Original");
  assert.equal(a.objects.size,2);
  assert.equal((await a.mutate({action:"delete",id,expectedUpdatedAt:original.updatedAt})).status,409);
  await ok(a.mutate({action:"delete",id:copy}));
  assert.equal(a.objects.has(original.objectKey),false);
  await ok(a.mutate({action:"delete",id},"final-delete"));
  assert.equal((await a.read(id)).status,404);
  await ok(a.mutate({action:"delete",id},"final-delete"));
  assert.equal(a.objects.size,0);
});

test("interrupted uploads expire and failed physical deletion can resume without exposing or re-registering bytes", async () => {
  const { sql, env, objects, upload, mutate, read, sweep, user } = documents();
  sql.exec("CREATE TRIGGER pause BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'storage interruption'); END");
  assert.equal((await upload({data:{}},file(),"abandoned")).status,503);
  const [key] = objects.keys();
  assert.equal(sql.prepare("SELECT state FROM file_transfers WHERE object_key=?").get(key).state,"uploading");
  assert.equal((await call(env,"/api/files?key="+encodeURIComponent(key),{user})).status,404);
  sql.exec("DROP TRIGGER pause");
  const staged = await ok(upload(null,file("Unclaimed"),"stage"));
  sql.prepare("UPDATE file_transfers SET retry_at=0").run();
  assert.equal((await mutate({data:staged})).status,409);
  const gc = await ok(sweep()); assert.equal(gc.purged,2); assert.equal(objects.size,0);
  assert.equal((await upload({data:{}},file(),"abandoned")).status,410);
  const stored = await ok(upload({data:{}},file("Final"),"fresh"));
  const doc = stored.data.documents[0];
  const originalDelete = env.BUCKET.delete;
  env.BUCKET.delete = async () => { throw new Error("Bucket temporarily unavailable"); };
  const removed = await ok(mutate({action:"delete",id:doc.id},"delete"));
  assert.equal(removed.cleanup.pending,1);
  assert.equal((await read(doc.id)).status,404);
  assert.equal(objects.has(doc.objectKey),true);
  assert.equal((await mutate({data:{objectKey:doc.objectKey}})).status,404);
  const bytes = objects.get(doc.objectKey);
  env.BUCKET.delete = originalDelete;
  sql.prepare("UPDATE file_transfers SET retry_at=0 WHERE object_key=?").run(doc.objectKey);
  const replay = await ok(mutate({action:"delete",id:doc.id},"delete")); assert.equal(replay.cleanup.pending,0);
  assert.equal(objects.size,0);
  // A late put of known bytes is recoverable. An unknown object from before
  // reservation tracking and a changed version both stay untouched.
  objects.set(doc.objectKey,{...bytes,etag:"different"});
  const unknown = key.replace(/[^/]+$/,"untracked");
  objects.set(unknown,bytes);
  assert.equal((await ok(sweep())).pending,1);
  assert.equal(objects.has(doc.objectKey),true);
  objects.set(doc.objectKey,bytes);
  sql.prepare("UPDATE file_transfers SET retry_at=0 WHERE object_key=?").run(doc.objectKey);
  assert.equal((await ok(sweep())).purged,1);
  assert.deepEqual([...objects.keys()],[unknown]);
});

test("upload size, incomplete transport and safe disposition apply through the Worker", async () => {
  const { upload, read, env, user, counts, objects } = documents();
  const limit = 25*1024*1024;
  assert.equal((await upload({data:{}},file(""),"empty")).status,400);
  assert.equal((await upload({data:{}},file(new Uint8Array(limit+1)),"large")).status,413);
  const incomplete = await call(env,"/api/data",{user,method:"POST",headers:{"content-type":"multipart/form-data; boundary=missing"}});
  assert.equal(incomplete.status,400); assert.equal(counts.writes,0);
  const allowed = await ok(upload({data:{}},file(new Uint8Array(limit),"boundary.bin","application/octet-stream"),"boundary"));
  assert.equal(allowed.data.documents[0].size,limit);
  assert.equal((await (await read(allowed.recordId)).arrayBuffer()).byteLength,limit);
  const active = await ok(upload({data:{}},file("<h1>Meeting</h1>","notes.html","text/html"),"html"));
  const response = await read(active.recordId,"&open=1");
  assert.match(response.headers.get("content-disposition"),/^attachment/);
  assert.equal(response.headers.get("content-type"),"application/octet-stream");
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.equal(objects.size,2);
});

test("a paired local restore preserves the document ID, exact bytes, owner and committed upload receipt",async t => {
  const a = documents();
  const source = await ok(a.upload({data:{}},file("paired backup"),"paired"));
  const doc = source.data.documents[0];
  const folder = await mkdtemp(join(tmpdir(),"keystone-paired-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const path = join(folder,"workspace.sqlite");
  await backup(a.sql,path);
  const bytes = structuredClone(a.objects);
  await ok(a.mutate({action:"delete",id:doc.id}));
  assert.equal(a.objects.size,0);
  const sql = new DatabaseSync(path);
  t.after(()=>sql.close());
  const { env } = bindWorkspace(sql,a.user,bytes);
  const restored = await call(env,"/api/files?id="+doc.id,{user:a.user});
  assert.equal(restored.status,200);
  const sha = value => createHash("sha256").update(value).digest("hex");
  assert.equal(sha(await restored.bytes()),sha("paired backup"));
  assert.equal((await call(env,"/api/files?id="+doc.id,{user:"other-founder"})).status,403);
  assert.equal(JSON.parse(sql.prepare("SELECT result FROM command_receipts WHERE request_id='paired'").get().result).recordId,doc.id);
  bytes.get(doc.objectKey).etag = "different-version";
  assert.equal((await call(env,"/api/files?id="+doc.id,{user:a.user})).status,404);
});
