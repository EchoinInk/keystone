import assert from "node:assert/strict";
import test from "node:test";
import { call, fixture } from "./fixtures/workspace.mjs";
import { financialReport } from "../app/finance.ts";
import { submitCommand } from "../app/submit-command.ts";
import { configs } from "../app/record-fields.ts";

function workspace() {
  const { env, sql, counts, objects } = fixture();
  const post = (json, key = crypto.randomUUID(), path = "/api/data") => call(env, path, {
    user: env.FOUNDER_USER_ID, json, headers: { "Idempotency-Key": key },
  });
  const rows = table => sql.prepare("SELECT * FROM " + table + " ORDER BY rowid").all();
  const create = async (entity, data) => {
    const response = await post({ entity, action: "create", data });
    assert.equal(response.status, 200, response.ok ? "" : await response.text());
    return response.json();
  };
  return { env, sql, counts, objects, post, rows, create };
}

test("every writable collection rejects unknown fields; invalid commands leave business and audit tables empty", async () => {
  const { post, rows } = workspace();
  for (const entity of Object.keys(configs).filter(e => !["aiConversations","activityLogs","revisions"].includes(e))) {
    assert.equal((await post({ entity, data: { unknown: 1 } })).status, 400, entity);
  }
  for (const [entity, data] of [
    ["notes", { title: " " }], ["notes", { title: {} }], ["tasks", { title: "t", status: "bad" }],
    ["tasks", { title: "t", completedAt: "forged" }], ["invoices", { number: "i", tax: 0.001 }],
    ["invoices", { number: "i", amount: -1 }], ["invoices", { number: "i", status: "Paid" }],
    ["expenses", { description: "x", incurredAt: "2026-02-30" }], ["revenueGoals", { period: "2026-15", target: 1 }],
    ["payments", { paidAt: "2026-10-01", amount: 2 }], ["leads", { name: "l", probability: 101 }],
  ]) assert.equal((await post({ entity, data })).status, 400, entity);
  for (const command of [
    { entity: "notes", action: "update", data: { title: "bad" } },
    { entity: "notes", action: "delete", ids: ["a","b"] },
    { entity: "notes", action: "bulkDelete", ids: ["a","a"] },
    { entity: "notes", data: [] }, { entity: "notes", action: "unknown" },
    { entity: ["notes"], data: {title:"bad"} }, { entity:"notes", action:null, data:{title:"bad"} },
  ]) assert.equal((await post(command)).status, 400);
  assert.equal((await post({ entity: "notes", data: { title: "n" } }, "")).status, 400);
  for (const table of ["tasks","notes","invoices","payments","revisions","activity_logs","command_receipts"]) assert.deepEqual(rows(table), []);
});

test("concurrent replay commits once, reused key with different intent conflicts, and stale editors lose", async () => {
  const { post, rows } = workspace();
  const create = { entity: "notes", data: { title: "A", body: "Text" } };
  const [a,b] = await Promise.all([post(create,"create"), post({ data: { body: "Text", title: "A" }, entity: "notes" },"create")]);
  assert.deepEqual([a.status,b.status], [200,200]);
  const { recordId: id, data } = await a.json();
  assert.equal((await b.json()).recordId, id);
  assert.equal((await post({ ...create, data: { title: "B" } }, "create")).status, 409);
  const edit = title => ({ entity: "notes", action: "update", id, expectedUpdatedAt: data.notes[0].updatedAt, data: { title } });
  const updates = await Promise.all([post(edit("B")), post(edit("C"))]);
  assert.deepEqual(updates.map(r => r.status).sort(), [200,409]);
  const before = rows("revisions").map(row => JSON.parse(row.snapshot));
  assert.deepEqual(before.map(r => r.title), ["A","A"]);
  assert.equal(rows("command_receipts").length, 2);
  assert.equal(rows("activity_logs").length, 2);
});

test("late failures undo bulk deletes and every before-image; retry after deletion returns the original IDs", async () => {
  const { sql, rows, create, post } = workspace();
  const ids = [];
  for (const title of ["N1","N2","N3"]) ids.push((await create("notes", { title })).recordId);
  const cmd = { entity: "notes", action: "bulkDelete", ids }, tables = ["notes","revisions","activity_logs","command_receipts"];
  const before = tables.map(rows);
  sql.exec("CREATE TRIGGER interrupt BEFORE INSERT ON activity_logs WHEN NEW.label='N3 deleted' BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  assert.equal((await post(cmd, "delete")).status, 503);
  assert.deepEqual(tables.map(rows), before);
  sql.exec("DROP TRIGGER interrupt");
  assert.deepEqual((await (await post(cmd,"delete")).json()).recordIds, ids);
  assert.equal((await post(cmd,"delete")).status, 200);
  assert.equal(rows("notes").length, 0);
  assert.deepEqual(rows("revisions").filter(r=>r.action==="delete").map(r=>JSON.parse(r.snapshot).id),ids);
  assert.deepEqual(rows("activity_logs").filter(r=>r.action==="bulkDelete").map(r=>r.record_id),ids);
});

test("void, partial, full and fractional settlement reconcile across dashboard, source rows and advice beyond 40 invoices", async () => {
  const { post, create, rows, sql } = workspace();
  const paidAt = new Date().toISOString().slice(0,10);
  const { recordId: invoiceId } = await create("invoices", { number: "INV-1", amount: 90.01, tax: 9.99, status: "Sent" });
  await create("invoices", { number: "VOID", amount: 100, tax: 15, status: "Void" });
  await create("expenses", { description: "expense", amount: 0.12, incurredAt: paidAt });
  await create("revenueGoals", { period: paidAt.slice(0,7), target: 100 });
  const pay = (amount, reference) => ({ entity: "payments", data: { invoiceId, amount, reference, paidAt } });
  const command = pay(20,"transfer-1"), partial = await (await post(command,"partial")).json();
  assert.equal(partial.metrics.outstanding,80);
  assert.equal(partial.metrics.profit,19.88);
  assert.equal(partial.metrics.openInvoices,1);
  assert.equal(partial.metrics.goalProgress,20);
  assert.equal(partial.data.invoices.find(r=>r.id===invoiceId).status,"Part paid");
  assert.equal((await post(command,"partial")).status,200);
  assert.equal((await post(pay(20," TRANSFER-1 "))).status,409);
  assert.equal((await post({entity:"invoices",data:{number:" inv-1 "}})).status,409);
  for(let i=0;i<42;i++) sql.prepare("INSERT INTO invoices(id,number,status,created_at,updated_at) VALUES(?,?,'Void','later','later')").run("v"+i,"v"+i);
  const ask = { page:"Tasks",prompt:"Which invoices need follow-up?" };
  const a = await (await post(ask,"ask","/api/assistant")).json();
  assert.match(a.response,/Outstanding is \$80.00/);
  assert.match(a.response,/INV-1/);
  assert.equal((await (await post(ask,"ask","/api/assistant")).json()).response,a.response);
  assert.equal(rows("ai_conversations").length,1);
  const settle = await Promise.all([post(pay(80,"A")),post(pay(80,"B"))]);
  assert.deepEqual(settle.map(r=>r.status).sort(),[200,409]);
  const final = await settle.find(r=>r.ok).json();
  assert.equal(final.metrics.outstanding,0);
  assert.equal(final.metrics.openInvoices,0);
  assert.equal(final.metrics.totalRevenue,100);
  assert.equal(final.data.invoices.find(r=>r.id===invoiceId).status,"Paid");
  assert.equal(rows("payments").length,2);
  for(const data of [{status:"Void"},{amount:0}]) assert.equal((await post({entity:"invoices",action:"update",id:invoiceId,data})).status,409);
  const receiptId = partial.recordId;
  const adjustment = await (await post({entity:"payments",action:"update",id:receiptId,data:{amount:19.99}})).json();
  assert.equal(adjustment.metrics.outstanding,0.01);
  assert.equal(adjustment.metrics.totalRevenue,99.99);
  assert.equal(JSON.parse(rows("revisions").find(r=>r.record_id===receiptId&&r.action==="update").snapshot).amount,20);
});

test("read-time reconciliation preserves disputed historical source rows and produces six distinct UTC months", async () => {
  const { env, sql, rows } = workspace();
  sql.exec("INSERT INTO invoices(id,number,amount,status,created_at,updated_at) VALUES('old','H1',100,'Paid','before','before')");
  sql.exec("INSERT INTO payments(id,amount,paid_at,created_at,updated_at) VALUES('unlinked',1.23,'2024-02-29','before','before')");
  const source = ["invoices","payments","activity_logs","revisions","command_receipts"];
  const before = source.map(rows);
  const { metrics, reconciliation, data } = await (await call(env,"/api/data",{user:env.FOUNDER_USER_ID})).json();
  assert.equal(metrics.totalRevenue,1.23);
  assert.equal(metrics.outstanding,100);
  assert.equal(data.invoices[0].recordedStatus,"Paid");
  assert.equal(data.invoices[0].status,"Unpaid");
  assert.deepEqual(reconciliation.map(i=>i.id).sort(),["old","unlinked"]);
  assert.deepEqual(source.map(rows),before);
  const feb = financialReport([], [{amount:0.1,paidAt:"2024-02-29"},{amount:0.2,paidAt:"2024-02-29"}], [], new Date("2024-03-31T23:59:59Z"));
  assert.equal(feb.metrics.totalRevenue,0.3);
  assert.deepEqual(feb.metrics.history.map(p=>p.period),["2023-10","2023-11","2023-12","2024-01","2024-02","2024-03"]);
  assert.equal(feb.metrics.history[4].value,0.3);
});

test("interrupted multipart document command keeps bytes private, retries the same object and commits metadata and history together", async () => {
  const { env, sql, objects, rows } = workspace();
  const upload = () => {
    const form = new FormData();
    form.set("file",new File(["proof"],"proof.txt"));
    form.set("command",JSON.stringify({entity:"documents",data:{}}));
    return call(env,"/api/data",{user:env.FOUNDER_USER_ID,form,headers:{"Idempotency-Key":"doc"}});
  };
  sql.exec("CREATE TRIGGER interrupt BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'stop'); END");
  assert.equal((await upload()).status,503);
  for(const table of ["documents","workspace_files","command_receipts","revisions","activity_logs"]) assert.deepEqual(rows(table),[]);
  const [key] = objects.keys();
  assert.equal((await call(env,"/api/files?key="+encodeURIComponent(key),{user:env.FOUNDER_USER_ID})).status,404);
  sql.exec("DROP TRIGGER interrupt");
  const [a,b] = await Promise.all([upload(),upload()]);
  assert.deepEqual([a.status,b.status],[200,200]);
  assert.equal((await a.json()).recordId,(await b.json()).recordId);
  assert.equal(objects.size,1);
  assert.equal(rows("workspace_files").length,1);
  assert.equal(rows("documents").length,1);
});

test("lost post-commit snapshot response is recoverable with the original request key", async () => {
  const { env, post, rows } = workspace();
  const batch = env.DB.batch;
  let drop = true;
  env.DB.batch = statements => {
    if (statements.length === 41 && drop) {
      drop = false;
      throw new Error("Connection interrupted after durable commit");
    }
    return batch(statements);
  };
  const command = {entity:"notes",data:{title:"one record"}};
  assert.equal((await post(command,"lost")).status,503);
  assert.equal((await post(command,"lost")).status,200);
  for (const table of ["notes","activity_logs","revisions","command_receipts"]) assert.equal(rows(table).length,1);
});

test("provider interruption reserves one attempt, rolls back history and resumes using local advice", async t => {
  const { env, sql, post, rows } = workspace();
  env.OPENAI_API_KEY="fixture";
  const provider = t.mock.method(globalThis,"fetch",async()=>Response.json({output_text:"remote attempt"}));
  const ask=()=>post({page:"Tasks",prompt:"What is next?"},"turn","/api/assistant");
  sql.exec("CREATE TRIGGER interrupt BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'stop'); END");
  assert.equal((await ask()).status,503);
  assert.deepEqual(rows("ai_conversations"),[]);
  assert.deepEqual(rows("activity_logs"),[]);
  assert.equal(rows("command_receipts")[0].result,"pending");
  sql.exec("DROP TRIGGER interrupt");
  assert.equal((await ask()).status,409);
  assert.equal((await post({entity:"notes",data:{title:"conflict"}},"turn")).status,409);
  sql.exec("UPDATE command_receipts SET created_at='2000-01-01T00:00:00Z'");
  const resumed = await ask();
  assert.equal(resumed.status,200);
  assert.match((await resumed.json()).response,/open tasks/);
  assert.equal((await ask()).status,200);
  assert.equal(provider.mock.callCount(),1);
  assert.equal(rows("ai_conversations").length,1);
  assert.equal(rows("activity_logs").length,1);
});

test("form contracts create each writable collection through the Worker, with real parent IDs and database defaults in history", async () => {
  const { env, create, rows } = workspace();
  const ids = {};
  const form = new FormData();
  form.set("file", new File(["test"],"fixture.txt"));
  const upload = await call(env,"/api/files",{user:env.FOUNDER_USER_ID,form});
  const document = await upload.json();
  for (const [entity,fields] of Object.entries(configs)) {
    if (["aiConversations","activityLogs","revisions"].includes(entity)) continue;
    const data = {};
    for (const f of fields) {
      if (f.type === "file") Object.assign(data, document);
      else if (f.type === "relation") data[f.key] = f.required ? ids[f.relation] : "";
      else if (f.type === "date") data[f.key] = f.required ? "2026-11-19" : "";
      else if (f.type === "datetime-local") data[f.key] = f.required ? "2026-11-19T13:15" : "";
      else if (f.type === "select") data[f.key] = f.options[0];
      else if (f.type === "number") data[f.key] = 1;
      else if (f.type === "checkbox") data[f.key] = false;
      else data[f.key] = f.required ? (f.key === "period" ? "2026-11" : "Fixture") : "";
    }
    const result = await create(entity,data);
    ids[entity] = result.recordId;
    const snapshot = JSON.parse(rows("revisions").at(-1).snapshot);
    assert.equal(snapshot.id,result.recordId,entity);
    assert.equal(typeof snapshot.createdAt,"string");
  }
  assert.equal(Object.keys(ids).length,38);
  assert.equal(rows("activity_logs").length,38);
});

test("browser command helper keeps the same key through an unreadable response and allocates a new key after acknowledgement", async t => {
  const { env, rows } = workspace(), values = new Map(), keys = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{
    getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k),
  }});
  t.after(()=>{ if (prior) Object.defineProperty(globalThis,"sessionStorage",prior); else delete globalThis.sessionStorage; });
  t.mock.method(globalThis,"fetch",async(path,options)=>{
    const key = options.headers.get("Idempotency-Key");
    keys.push(key);
    const result = await call(env,path,{user:env.FOUNDER_USER_ID,json:JSON.parse(options.body),headers:{"Idempotency-Key":key}});
    return keys.length === 1 ? new Response("{") : result;
  });
  const save = ()=>submitCommand("founder","/api/data",{entity:"notes",data:{title:"same text"}});
  await assert.rejects(save);
  assert.equal(values.size,1);
  assert.equal((await save()).response.status,200);
  assert.equal(keys[1],keys[0]);
  assert.equal(values.size,0);
  assert.equal(rows("notes").length,1);
  await save();
  assert.notEqual(keys[2],keys[1]);
  assert.equal(rows("notes").length,2);
});

test("a receipt correction that contradicts a historical Paid label needs an explicit reviewed status change", async () => {
  const { sql, rows, post } = workspace();
  sql.exec("INSERT INTO invoices(id,number,amount,status,created_at,updated_at) VALUES('old','H1',100,'Paid','before','before')");
  sql.exec("INSERT INTO payments(id,invoice_id,amount,paid_at,created_at,updated_at) VALUES('p','old',100,'2026-10-01','before','before')");
  const original = rows("payments");
  const edit = {entity:"payments",action:"update",id:"p",data:{amount:99}};
  assert.equal((await post(edit)).status,409);
  assert.deepEqual(rows("payments"),original);
  assert.deepEqual(rows("revisions"),[]);
  assert.equal((await post({entity:"invoices",action:"update",id:"old",data:{status:"Sent"}})).status,200);
  assert.equal((await post(edit)).status,200);
  assert.equal(JSON.parse(rows("revisions")[0].snapshot).status,"Paid");
  assert.equal(JSON.parse(rows("revisions")[1].snapshot).amount,100);
});
