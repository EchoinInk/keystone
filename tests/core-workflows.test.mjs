import assert from "node:assert/strict";
import test from "node:test";
import { call, fixture } from "./fixtures/workspace.mjs";

function workspace(subject) {
  const { env, sql, objects } = fixture(subject);
  const user = env.FOUNDER_USER_ID;
  const send = (command, key = crypto.randomUUID()) => call(env, "/api/data", { user, json: command, headers: { "Idempotency-Key": key } });
  const get = async () => (await (await call(env, "/api/data", { user })).json()).data;
  const post = async (command, key) => {
    const response = await send(command, key);
    assert.equal(response.status, 200, response.ok ? "" : await response.text());
    return response.json();
  };
  const create = async (entity, data) => (await post({ entity, data })).recordId;
  const update = (entity, id, data) => post({ entity, action: "update", id, data });
  return { env, sql, objects, user, send, post, create, update, get };
}

const sprint = (name, status) => ({ name, goal: "Deliver", startDate: "2026-11-19", endDate: "2026-11-27", duration: "Custom", status });
const find = (rows, id) => rows.find(row => row.id === id);

test("task, sprint, project and weekly objective agree through completion, reopen, move, cancel and unlink", async () => {
  const { create, update, get, post, send, sql } = workspace();
  const first = await create("sprints", sprint("First", "Active"));
  const second = await create("sprints", sprint("Second", "Planned"));
  assert.equal((await send({ entity: "sprints", data: sprint("Competing", "Active") })).status, 409);
  assert.equal((await send({ entity: "sprints", data: { ...sprint("Bad dates", "Planned"), duration: 7 } })).status, 400);
  const project = await create("projects", { name: "Client delivery", progress: 70 });
  const weekly = await create("launchObjectives", { title: "Launch" });
  const next = await create("launchObjectives", { title: "Follow up" });
  const task = await create("tasks", { title: "Prepare brief", objectiveId: weekly, projectId: project, status: "In review" });
  // Linking an unassigned task from the daily objective assigns it to the sprint.
  const daily = await create("sprintObjectives", { sprintId: first, taskId: task, title: "Review brief" });
  const copy = (await post({ entity: "sprintObjectives", action: "duplicate", id: daily })).recordId;
  const standalone = await create("sprintObjectives", { sprintId: first, title: "Review day" });
  await update("sprintObjectives", standalone, { status: "Completed" });
  await create("sprintObjectives", { sprintId: first, title: "Deferred", status: "Cancelled" });
  async function check(id, total, completed) {
    const row = find((await get()).sprints, id);
    assert.deepEqual([row.duration, row.objectiveCount, row.completedObjectives], [9, total, completed]);
  }
  await check(first, 2, 1);
  let data = await get();
  assert.equal(find(data.tasks, task).sprintId, first);
  assert.deepEqual([find(data.sprintObjectives, copy).sprintId, find(data.sprintObjectives, copy).status], [first, "In review"]);
  assert.equal((await send({ entity:"sprintObjectives", action:"update", id:daily, data:{status:"Blocked"} })).status, 400);
  assert.equal((await send({ entity:"sprintObjectives", data:{sprintId:second, taskId:task, title:"Wrong sprint"} })).status, 409);
  assert.equal((await send({ entity:"launchObjectives", action:"update", id:weekly, data:{status:"Completed"} })).status, 400);
  await update("tasks", task, { status: "Completed" });
  data = await get();
  assert.equal(find(data.tasks, task).previousStatus, "In review");
  assert.ok(find(data.tasks, task).completedAt);
  assert.equal(find(data.launchObjectives, weekly).progressPercentage, 100);
  assert.equal(find(data.projects, project).progress, 100);
  assert.equal(find(data.sprintObjectives, daily).status, "Completed");
  await check(first, 2, 2);
  await update("tasks", task, { status: find(data.tasks, task).previousStatus });
  assert.equal(find((await get()).tasks, task).completedAt, null);
  const old = find((await get()).sprintObjectives, daily);
  sql.exec("CREATE TRIGGER stop_move BEFORE UPDATE OF sprint_id ON sprint_objectives BEGIN SELECT RAISE(ABORT,'fixture interruption'); END");
  const move = { entity:"tasks", action:"update", id:task, data:{ status:"Blocked", objectiveId:next, sprintId:second } };
  assert.equal((await send(move, "move")).status, 503);
  await check(first, 2, 1);
  assert.equal(find((await get()).tasks, task).objectiveId, weekly);
  sql.exec("DROP TRIGGER stop_move");
  await post(move, "move"); await post(move, "move");
  data = await get();
  for (const id of [daily, copy]) assert.equal(find(data.sprintObjectives, id).sprintId, second);
  assert.equal(find(data.launchObjectives, weekly).taskCount, 0);
  assert.equal(find(data.launchObjectives, next).status, "Blocked");
  assert.equal((await send({ entity:"sprintObjectives",action:"update",id:daily,expectedUpdatedAt:old.updatedAt,data:{title:"stale"} })).status, 409);
  await check(first, 1, 1); await check(second, 1, 0);
  await update("tasks", task, { status:"Cancelled" });
  await check(second, 0, 0);
  assert.equal(find((await get()).launchObjectives, next).taskCount, 0);
  assert.equal(find((await get()).projects, project).progress, 0);
  assert.equal((await send({entity:"tasks",action:"delete",id:task})).status,409);
  await update("tasks", task, { sprintId:null, objectiveId:null });
  await post({entity:"tasks",action:"delete",id:task});
  data = await get();
  assert.equal(find(data.sprintObjectives, daily).taskId, null);
  assert.equal(find(data.projects, project).progress, 70);
  assert.equal(find(data.tasks, task), undefined);
  assert.equal(sql.prepare("SELECT count(*) n FROM command_receipts WHERE request_id='move'").get().n,1);
});

test("historical reverse links and status aliases remain visible and can be explicitly reassigned", async () => {
  const { create, get, update, sql } = workspace();
  const s = await create("sprints", sprint("Legacy sprint", "Active"));
  const t = await create("tasks", {title:"Historical"});
  const w = await create("launchObjectives", {title:"Weekly"});
  sql.prepare("UPDATE tasks SET status='Done',previous_status='Todo' WHERE id=?").run(t);
  sql.prepare("UPDATE launch_objectives SET task_id=? WHERE id=?").run(t,w);
  sql.prepare("INSERT INTO sprint_objectives(id,sprint_id,task_id,title,status,created_at,updated_at) VALUES('historic',?,?,'Day','Todo','old','old')").run(s,t);
  const before = await get();
  assert.deepEqual([before.tasks[0].status,before.tasks[0].objectiveId,before.tasks[0].sprintId],["Completed",w,s]);
  assert.equal(before.launchObjectives[0].completedTaskCount,1);
  assert.equal(before.sprints[0].completedObjectives,1);
  assert.equal(before.sprintObjectives[0].status,"Completed");
  await update("sprintObjectives","historic",{taskId:null});
  assert.equal((await get()).sprintObjectives[0].status,"Completed");
  await update("sprintObjectives","historic",{taskId:t});
  await update("tasks",t,{sprintId:null,objectiveId:null,status:"To do"});
  const after = await get();
  assert.equal(after.tasks[0].sprintId,null);
  assert.equal(after.tasks[0].objectiveId,null);
  assert.equal(after.launchObjectives[0].taskCount,0);
  assert.equal(after.sprintObjectives[0].taskId,null);
  assert.equal(after.sprintObjectives[0].status,"To do");
  // Earlier workspaces can have several active sprints. Resolving them is explicit.
  sql.prepare("INSERT INTO sprints(id,name,goal,start_date,end_date,status,created_at,updated_at) VALUES('other','Other','Goal','2026-11-19','2026-11-25','Active','a','b')").run();
  assert.equal((await get()).sprints.filter(row => row.status==="Active").length,2);
  await update("sprints","other",{status:"Archived"});
  assert.equal((await get()).sprints.filter(row => row.status==="Active").length,1);
});

test("won lead converts once, including an existing client, lead proposals and explicit project handoff", async () => {
  const { create, update, post, send, get, sql } = workspace();
  const lead = await create("leads", {name:"Ada",company:"Studio",email:"ada@example.test",notes:"Discovery complete"});
  const convert = {entity:"leads",action:"convert",id:lead};
  assert.equal((await send(convert)).status,409);
  assert.equal((await send({entity:"clients",data:{name:"Early",leadId:lead}})).status,409);
  const proposal = await create("proposals",{title:"Launch scope",leadId:lead});
  await update("leads",lead,{stage:"Qualified"});
  const won = await update("leads",lead,{stage:"Won"});
  assert.equal(find(won.data.leads,lead).status,"Closed");
  sql.exec("CREATE TRIGGER stop_handoff BEFORE UPDATE OF client_id ON proposals BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  assert.equal((await send(convert,"convert")).status,503);
  assert.equal((await get()).clients.length,0);
  sql.exec("DROP TRIGGER stop_handoff");
  const [a,b] = await Promise.all([post(convert,"convert"),post(convert,"convert")]);
  const client = a.recordId;
  assert.equal(b.recordId,client);
  assert.equal((await post(convert)).recordId,client);
  const data = await get();
  assert.equal(data.clients.length,1);
  assert.deepEqual([data.clients[0].email,data.clients[0].status,data.clients[0].leadId],["ada@example.test","Onboarding",lead]);
  assert.equal(find(data.proposals,proposal).clientId,client);
  assert.equal((await send({entity:"leads",action:"update",id:lead,data:{stage:"Lost"}})).status,409);
  assert.equal((await send({entity:"clients",data:{name:"Duplicate",leadId:lead}})).status,409);
  const project = await create("projects",{name:"Delivery",clientId:client});
  const other = await create("clients",{ name:"Existing" });
  const another = await create("leads",{name:"Second",stage:"Won"});
  const assoc = await post({entity:"leads",action:"convert",id:another,clientId:other});
  assert.equal(assoc.recordId,other);
  assert.equal(find(assoc.data.clients,other).name,"Existing");
  assert.equal((await send({...convert,clientId:other})).status,409);
  assert.equal((await send({entity:"tasks",data:{title:"Wrong client",projectId:project,clientId:other}})).status,409);
  assert.equal((await send({entity:"proposals",data:{title:"Wrong",leadId:lead,clientId:other}})).status,409);
  assert.equal((await get()).activityLogs.filter(l=>l.entity==="clients"&&l.recordId===client&&l.action==="create").length,1);
});
