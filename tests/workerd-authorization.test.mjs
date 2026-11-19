import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../scripts/migrations.mjs";
import { localWorker, origin } from "./fixtures/workerd.mjs";

test("local workerd enforces admission and document ownership with D1 and R2 bindings", async t => {
  const mf = localWorker(t);
  const request = (path, options) => mf.dispatchFetch(new URL(path, origin).href, options);
  const founderHeaders = { origin, cookie: "fixture=founder" };
  const db = await mf.getD1Database("DB", "site");
  assert.equal((await request("/api/data")).status, 401);
  assert.equal((await request("/api/data", { headers: { cookie: "fixture=other" } })).status, 403);
  assert.equal((await request("/api/files?key=known", {
    headers: { cookie: "fixture=expired", "oai-authenticated-user-id": "fixture-founder" },
  })).status, 401);
  assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='tasks'").first(), null);

  await migrate(db);
  assert.equal((await request("/api/data", { headers: founderHeaders })).status, 403);
  await db.prepare("INSERT INTO workspace_owner VALUES (1, ?, ?)").bind(origin, "fixture-founder").run();
  const form = new FormData();
  form.set("file", new File(["verified file"], "proof.txt"));
  const encoded = new Response(form);
  const uploaded = await request("/api/files", {
    method: "POST", headers: { ...founderHeaders, "Idempotency-Key": crypto.randomUUID(), "content-type": encoded.headers.get("content-type") },
    body: await encoded.arrayBuffer(),
  });
  assert.equal(uploaded.status, 200, uploaded.ok ? undefined : await uploaded.text());
  const file = await uploaded.json();
  const mutate = (command, key = crypto.randomUUID()) => request("/api/data", {
    method: "POST", headers: { ...founderHeaders, "Idempotency-Key": key, "content-type": "application/json" }, body: JSON.stringify(command),
  });
  const created = await mutate({ entity: "documents", action: "create", data: file });
  assert.equal(created.status, 200, created.ok ? undefined : await created.text());
  const id = (await created.json()).data.documents[0].id;
  const path = "/api/files?id=" + encodeURIComponent(id);
  assert.equal((await request(path, { headers: { cookie: "fixture=other" } })).status, 403);
  assert.equal(await (await request(path, { headers: founderHeaders })).text(), "verified file");
  assert.equal((await mutate({ entity: "documents", action: "delete", id })).status, 200);
  assert.equal((await request(path, { headers: founderHeaders })).status, 404);
  const bucket = await mf.getR2Bucket("BUCKET", "site");
  assert.equal(await bucket.head(file.objectKey), null, "Final reference revocation purges managed bytes");

  const invoice = await mutate({entity:"invoices",data:{number:"D1-1",amount:0.3}});
  assert.equal(invoice.status, 200);
  const invoiceId = (await invoice.json()).recordId;
  const payment = {entity:"payments",data:{invoiceId,amount:0.2,paidAt:"2026-11-19"}};
  const attempts = await Promise.all([mutate(payment,"pay"),mutate(payment,"pay")]);
  assert.deepEqual(attempts.map(r => r.status),[200,200]);
  assert.equal((await attempts[0].json()).metrics.outstanding,0.1);
  const final = {entity:"payments",data:{...payment.data,amount:0.1}};
  const competing = await Promise.all([mutate(final),mutate(final)]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM payments").first("n"),2);
  const rejected = await mutate({entity:"invoices",action:"delete",id:invoiceId});
  assert.equal(rejected.status,409);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM revisions WHERE entity='invoices' AND action='delete'").first("n"),0);
});

test("workerd serializes competing sprint assignments and lead conversions in D1",async t => {
  const mf = localWorker(t), db = await mf.getD1Database("DB","site");
  await migrate(db);
  await db.prepare("INSERT INTO workspace_owner VALUES(1,?,?)").bind(origin,"fixture-founder").run();
  const post = command => mf.dispatchFetch(origin+"/api/data",{method:"POST",headers:{origin,cookie:"fixture=founder",
    "content-type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(command)});
  async function create(entity,data) {
    const response = await post({entity,data});
    assert.equal(response.status,200,response.ok?"":await response.text());
    return (await response.json()).recordId;
  }
  const dates = {goal:"Review", startDate:"2026-11-19",endDate:"2026-11-25"};
  const starts = await Promise.all(["One","Two"].map(name=>post({entity:"sprints",data:{...dates,name,status:"Active"}})));
  assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
  const first = (await starts.find(r=>r.ok).json()).recordId;
  const second = await create("sprints",{...dates,name:"Next",status:"Planned"});
  const task = await create("tasks",{title:"Review"});
  const assignments = await Promise.all([first,second].map(sprintId => post({entity:"sprintObjectives",data:{title:"Assign",sprintId,taskId:task}})));
  assert.deepEqual(assignments.map(r=>r.status).sort(),[200,409]);
  const placed = await db.prepare("SELECT t.sprint_id task,o.sprint_id objective FROM tasks t JOIN sprint_objectives o ON o.task_id=t.id").all();
  assert.equal(placed.results.length,1);
  assert.equal(placed.results[0].task,placed.results[0].objective);
  const lead = await create("leads",{name:"Intake",stage:"Won"});
  const command = {entity:"leads",action:"convert",id:lead};
  const handoffs = await Promise.all([post(command),post(command)]);
  assert.ok(handoffs.some(r=>r.ok) && handoffs.every(r=>[200,409].includes(r.status)));
  const again = await post(command);
  assert.equal(again.status,200);
  const client = (await again.json()).recordId;
  assert.deepEqual((await db.prepare("SELECT id,lead_id FROM clients").all()).results,[{id:client,lead_id:lead}]);
  assert.equal(await db.prepare("SELECT count(*) n FROM revisions WHERE entity='clients'").first("n"),1);
});

test("workerd stores a 25 MiB attachment and rejects a larger replacement without changing its bytes",async t => {
  const mf = localWorker(t);
  const db = await mf.getD1Database("DB","site");
  await migrate(db);
  await db.prepare("INSERT INTO workspace_owner VALUES(1,?,?)").bind(origin,"fixture-founder").run();
  const limit = 25 * 1024 * 1024;
  async function upload(bytes, command) {
    const form = new FormData();
    form.set("command",JSON.stringify({entity:"documents",...command}));
    form.set("file",new File([bytes],"large.bin",{type:"application/octet-stream"}));
    const encoded = new Response(form);
    return mf.dispatchFetch(origin+"/api/data",{method:"POST",headers:{origin,cookie:"fixture=founder",
      "Idempotency-Key":crypto.randomUUID(),"content-type":encoded.headers.get("content-type")},body:await encoded.arrayBuffer()});
  }
  const bytes = new Uint8Array(limit); bytes[0]=23; bytes[limit-1]=97;
  const accepted = await upload(bytes,{ data:{} });
  assert.equal(accepted.status,200,accepted.ok?"":await accepted.text());
  const { recordId:id } = await accepted.json();
  const rejected = await upload(new Uint8Array(limit+1),{action:"update",id,data:{}});
  assert.equal(rejected.status,413);
  const response = await mf.dispatchFetch(origin+"/api/files?id="+id,{headers:{cookie:"fixture=founder"}});
  assert.equal(response.status,200);
  const downloaded = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(downloaded,bytes);
});
