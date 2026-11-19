import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { call, fixture } from "./fixtures/workspace.mjs";
import { messageEnvelope, providerAnswer } from "./fixtures/assistant.mjs";

function assistant(subject = "founder", legacy) {
  const { env, sql } = fixture(subject, legacy);
  const post = (json, key = crypto.randomUUID(), headers = {}) => call(env, "/api/assistant", {
    user:subject, json, headers:{"Idempotency-Key":key, ...headers},
  });
  const read = id => call(env, "/api/assistant?id=" + encodeURIComponent(id), {user:subject});
  const snapshot = () => call(env, "/api/data", {user:subject});
  const question = (prompt = "What is next?", page = "Tasks") => ({page, prompt, mode:"review"});
  const decision = (turn, action = "approve", key) => post({action, conversationId:turn.id}, key);
  return { env, sql, post, read, snapshot, question, decision };
}

async function ok(response) {
  const json = await response.json();
  assert.equal(response.status, 200, json.error);
  return json;
}

test("local coaching, financial advice and historical transcripts remain accessible only inside the owning workspace", async t => {
  const legacy = sql => sql.prepare("INSERT INTO ai_conversations(id,page,prompt,response,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("original-turn","Tasks","Historical question","Original answer","2025-01-01","2025-01-01");
  const a = assistant("founder-a", legacy), b = assistant("founder-b");
  await ok(await a.snapshot());
  const provider = t.mock.method(globalThis, "fetch", () => providerAnswer());
  const old = await ok(await a.read("original-turn"));
  assert.equal(old.providerStatus, "legacy");
  assert.equal(old.response, "Original answer");
  assert.equal(old.approvedAt, null);
  const historical = {page:"Tasks", prompt:"Historical question"};
  const fingerprint = createHash("sha256").update(JSON.stringify(["/api/assistant",historical])).digest("hex");
  a.sql.prepare("INSERT INTO command_receipts VALUES(?,?,?,?)")
    .run("old-key",fingerprint,JSON.stringify({conversationId:old.id}),"2025-01-01");
  assert.equal((await ok(await a.post(historical,"old-key"))).id,old.id);
  assert.equal((await b.read("original-turn")).status, 404);
  assert.equal((await a.decision(old)).status, 409);

  a.env.OPENAI_API_KEY = "synthetic";
  a.sql.prepare("INSERT INTO command_receipts VALUES(?,?,?,?)").run("old-pending",fingerprint,"pending","2025-01-01");
  assert.equal((await ok(await a.post(historical,"old-pending"))).providerStatus,"local");
  for (const page of ["Mission Control","Freelance Launch","Tasks","Sprints","Activity","Revenue","Clients","Projects","Products","Content","Finance","Knowledge Base"]) {
    const local = await ok(await a.post({page, prompt:"Give me a suggestion"}));
    assert.equal(local.providerStatus, "local", page);
    assert.ok(local.response.trim());
    assert.equal((await a.decision(local)).status, 409);
    assert.equal((await b.read(local.id)).status, 404);
  }
  const finance = await ok(await a.post(a.question("Which invoices need follow-up?")));
  assert.equal(finance.preview, null);
  assert.equal(finance.providerStatus, "local");
  assert.match(finance.response, /Outstanding/);
  delete a.env.OPENAI_API_KEY;
  const offline = await ok(await a.post(a.question()));
  assert.equal(offline.providerStatus, "failed");
  assert.equal(offline.providerIssue, "unavailable");
  assert.ok(offline.response);
  assert.equal(offline.approvedAt, null);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal((await ok(await b.snapshot())).data.aiConversations.length, 0);
});

test("only the reviewed snapshot can be sent and a declined request stays local on replay", async t => {
  const a = assistant();
  await ok(await a.snapshot());
  a.env.OPENAI_API_KEY = "synthetic";
  const addTask = a.sql.prepare("INSERT INTO tasks(id,title,description,notes,status,created_at,updated_at) VALUES(?,?,?,?,'To do',?,?)");
  for (let n=0; n<8; n++) addTask.run("private-id-"+n,"Task "+n,"Private description","Private notes","2026-01-01","2026-01-0"+(n+1));
  a.sql.exec("INSERT INTO clients(id,name,company,email,phone,notes,created_at,updated_at) VALUES('c','Personal name','Customer studio','private@example.test','secret-phone','secret-memo','old','old')");
  const provider = t.mock.method(globalThis, "fetch", () => providerAnswer());
  const input = a.question("Compare my work"), pending = await ok(await a.post(input, "draft"));
  assert.deepEqual(await ok(await a.post(input,"draft")), pending);
  assert.equal((await a.post({...input, prompt:"another question"},"draft")).status,409);
  assert.equal(pending.providerStatus,"pending");
  const sample = JSON.parse(pending.preview);
  assert.equal(sample.question,input.prompt);
  assert.equal(sample.records.tasks.length,5);
  assert.equal(sample.records.tasks[0].title,"Task 7");
  assert.doesNotMatch(pending.preview, /private-id|Private notes|Private description|private@example|Personal name|secret-phone|secret-memo/);
  const listed = (await ok(await a.snapshot())).data.aiConversations[0];
  assert.equal(listed.id,pending.id);
  assert.equal(listed.providerStatus,"pending");
  assert.ok(!Object.hasOwn(listed,"providerContext") && !Object.hasOwn(listed,"preview"));
  assert.equal((await ok(await a.read(pending.id))).preview,pending.preview);
  a.sql.exec("UPDATE tasks SET title='New private title'");
  assert.equal((await a.post({action:"approve",conversationId:pending.id,context:"substitute input"})).status,400);
  assert.equal((await a.post({action:"completeTask",conversationId:pending.id})).status,403);
  assert.equal((await a.post({...input,mode:["review"]})).status,400);
  assert.equal((await a.post({action:"approve",conversationId:pending.id}, "wrong-ws", {"X-Keystone-Workspace":"stale"})).status,403);
  assert.equal(provider.mock.callCount(),0);
  const completed = await ok(await a.decision(pending));
  assert.equal(completed.providerStatus,"completed");
  assert.equal(completed.preview,null);
  assert.ok(completed.approvedAt);
  const [url, options] = provider.mock.calls[0].arguments;
  const body = JSON.parse(options.body);
  assert.equal(url,"https://api.openai.com/v1/responses");
  assert.equal(body.input,pending.preview);
  assert.equal(body.store,false);
  assert.deepEqual(body.tools,[]);
  assert.equal(body.text.format.strict,true);
  assert.deepEqual(await ok(await a.read(pending.id)),completed);
  assert.equal(a.sql.prepare("SELECT provider_context FROM ai_conversations WHERE id=?").get(pending.id).provider_context,null);
  assert.equal((await a.decision(pending,"decline")).status,409);

  const another = await ok(await a.post(input));
  assert.equal((await ok(await a.decision(another,"decline","decline"))).providerStatus,"declined");
  assert.equal((await ok(await a.decision(another,"decline","decline"))).approvedAt,null);
  assert.equal((await a.decision(another)).status,409);
  assert.equal((await ok(await a.read(another.id))).preview,null);
  assert.equal(provider.mock.callCount(),1);
  assert.equal(a.sql.prepare("SELECT count(*) n FROM tasks WHERE status='To do'").get().n,8);
});

test("provider contract failures keep the saved rules-based suggestion and never run model actions", async t => {
  const a = assistant();
  await ok(await a.snapshot());
  a.env.OPENAI_API_KEY = "synthetic";
  const good = JSON.stringify({kind:"suggestion",text:"Suggested step"});
  const envelope = text => messageEnvelope([{type:"output_text",text}]);
  const cases = [
    ["unavailable", () => new Response("private upstream error", {status:503})],
    ["rate_limited", () => new Response(null, {status:429})],
    ["unavailable", () => { throw new TypeError("private network detail"); }],
    ["timeout", () => { throw new DOMException("Timed out","TimeoutError"); }],
    ["invalid_output", () => new Response("not JSON")],
    ["invalid_output", () => Response.json({output_text:"unverified answer"})],
    ["incomplete", () => Response.json({...envelope(good),status:"incomplete"})],
    ["unavailable", () => Response.json({...envelope(good),status:"failed",error:{message:"private"}})],
    ["refused", () => Response.json(messageEnvelope([{type:"refusal",refusal:"private refusal"}]))],
    ["invalid_output", () => Response.json({...envelope(good),output:[]})],
    ["invalid_output", () => Response.json(envelope("plain or truncated output"))],
    ["invalid_output", () => Response.json(envelope(JSON.stringify({kind:"suggestion",text:"   "})))],
    ["invalid_output", () => Response.json(envelope(JSON.stringify({kind:"completed",text:"Executed"})))],
    ["invalid_output", () => Response.json(envelope(JSON.stringify({kind:"suggestion",text:"Change a record",action:"delete"})))],
    ["invalid_output", () => Response.json({...envelope(good),output:[...envelope(good).output,{type:"function_call",name:"delete",arguments:"{}"}]})],
    ["invalid_output", () => Response.json(envelope(JSON.stringify({kind:"suggestion",text:"x".repeat(12001)})))],
    ["invalid_output", () => new Response("x".repeat(131073))],
  ];
  let respond;
  const provider = t.mock.method(globalThis,"fetch",(...args) => respond(...args));
  for (const [expected, makeResponse] of cases) {
    respond = makeResponse;
    const local = await ok(await a.post(a.question()));
    const result = await ok(await a.decision(local));
    assert.equal(result.providerIssue,expected);
    assert.equal(result.providerStatus,"failed");
    assert.equal(result.response,local.response);
    assert.deepEqual(await ok(await a.decision(local)),result);
    assert.deepEqual(await ok(await a.read(local.id)),result);
  }
  assert.equal(provider.mock.callCount(),cases.length);
  assert.equal(a.sql.prepare("SELECT count(*) n FROM tasks").get().n,0);
  assert.equal(a.sql.prepare("SELECT count(*) n FROM revisions").get().n,0);
});

test("overlapping approvals, a lost acknowledgement and a later retry dispatch once", async t => {
  const a = assistant();
  await ok(await a.snapshot());
  a.env.OPENAI_API_KEY = "fixture";
  const pending = await ok(await a.post(a.question()));
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const provider = t.mock.method(globalThis,"fetch",async () => { started.resolve(); await finish.promise; return providerAnswer("One confirmed suggestion"); });
  const first = a.decision(pending,"approve","first");
  await started.promise;
  const overlap = await Promise.all([a.decision(pending,"approve","first"),a.decision(pending,"approve","second")]);
  for (const ack of overlap) assert.equal((await ok(ack)).providerStatus,"running");
  assert.equal((await ok(await a.read(pending.id))).providerStatus,"running");
  assert.equal((await a.decision(pending,"decline")).status,409);
  finish.resolve();
  await first; // The caller loses this response body.
  const replay = await ok(await a.decision(pending,"approve","first"));
  assert.equal(replay.providerStatus,"completed");
  assert.equal(replay.response,"One confirmed suggestion");
  assert.deepEqual(await ok(await a.decision(pending)),replay);
  assert.equal(provider.mock.callCount(),1);
  assert.equal(a.sql.prepare("SELECT count(*) n FROM activity_logs WHERE record_id=?").get(pending.id).n,1);
});

test("approval survives interruption before dispatch, missing credentials and workspace request limits", async t => {
  const a = assistant();
  await ok(await a.snapshot());
  a.env.OPENAI_API_KEY = "fixture";
  const provider = t.mock.method(globalThis,"fetch",() => providerAnswer());
  const pending = await ok(await a.post(a.question()));
  const withdraw = await ok(await a.post(a.question("A second proposed request")));
  a.sql.exec("CREATE TRIGGER stop_claim BEFORE UPDATE ON ai_conversations WHEN NEW.provider_status='running' BEGIN SELECT RAISE(ABORT,'stop'); END");
  assert.equal((await a.decision(pending,"approve","decision")).status,503);
  assert.equal((await ok(await a.read(pending.id))).providerStatus,"approved");
  assert.equal((await a.decision(withdraw)).status,503);
  assert.equal((await ok(await a.decision(withdraw,"decline"))).providerStatus,"declined");
  assert.equal((await a.decision(withdraw)).status,409);
  assert.equal(provider.mock.callCount(),0);
  a.sql.exec("DROP TRIGGER stop_claim");
  assert.equal((await ok(await a.decision(pending,"approve","decision"))).providerStatus,"completed");
  assert.equal(provider.mock.callCount(),1);

  const noKey = await ok(await a.post(a.question()));
  delete a.env.OPENAI_API_KEY;
  assert.equal((await ok(await a.decision(noKey))).providerIssue,"unavailable");
  a.env.OPENAI_API_KEY = "fixture";
  for (let i=0; i<19; i++) a.sql.prepare(`INSERT INTO ai_conversations(id,page,prompt,response,provider_status,provider_started_at,created_at,updated_at)
    VALUES(?,'Tasks','Earlier question','Prior answer','completed',?,'old','old')`).run("prior-"+i,new Date().toISOString());
  const limited = await ok(await a.decision(await ok(await a.post(a.question()))));
  assert.equal(limited.providerIssue,"rate_limited");
  assert.equal(provider.mock.callCount(),1);
});

test("the provider deadline cancels a stalled response body and records a retry-safe timeout", async t => {
  const a = assistant();
  await ok(await a.snapshot());
  a.env.OPENAI_API_KEY = "fixture";
  const pending = await ok(await a.post(a.question("Check the next deadline")));
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  let aborted = false, deadline;
  t.mock.method(AbortSignal, "timeout", ms => {
    deadline = ms;
    return timeout(10);
  });
  const provider = t.mock.method(globalThis, "fetch", (_url, {signal}) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"status":"completed"'));
      signal.addEventListener("abort", () => { aborted = true; controller.error(signal.reason); }, {once:true});
    },
  })));
  // AbortSignal's native timer is unref'd in Node.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const result = await ok(await a.decision(pending));
    assert.equal(deadline,20000);
    assert.equal(aborted,true);
    assert.equal(result.providerIssue,"timeout");
    assert.equal(result.response,pending.response);
    assert.deepEqual(await ok(await a.decision(pending)),result);
    assert.equal(provider.mock.callCount(),1);
  } finally { clearTimeout(keepAlive); }
});
