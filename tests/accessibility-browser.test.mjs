import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { engineName, founderBrowser, navigateTo } from "./fixtures/browser.mjs";
import { localWorker, origin } from "./fixtures/workerd.mjs";
import { migrate } from "../scripts/migrations.mjs";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
// macOS WebKit uses Option-Tab for full keyboard traversal with the default system preference.
const nextControl = engineName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
const desktop = { viewport: { width: 1440, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const views = ["Mission Control", "Freelance Launch", "Tasks", "Sprints", "Activity", "Revenue",
  "Clients", "Projects", "Products", "Content", "Finance", "Knowledge Base"];
const keyOf = (entity, suffix = "new") => "founder-os-draft:" + scope + ":" + entity + ":" + suffix;
const scope = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify([origin, "fixture-founder"])))), b => b.toString(16).padStart(2, "0")).join("");
const button = (root, name) => root.getByRole("button", { name, exact: true });
const post = page => page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/data");

async function workspace(t, options) {
  const fixture = await founderBrowser(t, { ...options, reducedMotion: "reduce" });
  await fixture.page.goto(fixture.url);
  await fixture.page.getByRole("heading", { level: 1 }).waitFor();
  return fixture;
}
async function audit(page, state) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: axePath });
  const failures = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } });
    return result.violations.map(v => ({ rule: v.id, elements: v.nodes.map(n => n.target) }));
  });
  assert.deepEqual(failures, [], state);
}
async function focused(locator) {
  await locator.page().waitForFunction(el => document.activeElement === el, await locator.elementHandle());
}
async function save(page) {
  const dialog = page.getByRole("dialog");
  const [res] = await Promise.all([post(page), button(dialog, "Save record").click()]);
  assert.equal(res.ok(), true, await res.text());
  await dialog.waitFor({state:"hidden"});
  return res.json();
}
async function reflow(page) {
  const sizes = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
  assert.ok(sizes[1] <= sizes[0] + 1, "Horizontal overflow at " + sizes.join(" / "));
}

test("primary navigation, history, reflow and reduced motion across founder views", {timeout:120000}, async t => {
  const {page} = await workspace(t, {...desktop, hasTouch:true});
  await page.evaluate(async () => {
    for (const [entity, data] of [
      ["tasks", {title:"Review the delivery brief and confirm the accessibility acceptance criteria"}],
      ["leads", {name:"Sample founder", company:"Independent design studio"}],
      ["knowledge", {title:"Handoff decisions", category:"Delivery", body:"Confirm the record owner on handoff."}],
      ["invoices", {number:"REVIEW-001", amount:120.50}],
      ["launchObjectives", {title:"Prepare the founder pilot for review"}],
    ]) {
      const res = await fetch("/api/data", {method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
        body:JSON.stringify({entity,action:"create",data})});
      if (!res.ok) throw new Error(await res.text());
    }
  });
  await page.reload();
  for (const [width, height] of [[1440,900], [820,1180], [390,844], [844,390], [720,450], [320,640]]) {
    await page.setViewportSize({width, height});
    if (width === 1440) {
      const rail = page.getByRole("navigation",{name:"Primary navigation"});
      await rail.waitFor();
      assert.ok(await rail.evaluate(el => el.scrollHeight <= el.clientHeight + 1), "All desktop destinations fit the rail");
    }
    for (const name of views) {
      await navigateTo(page, name, width <= 1100);
      await focused(page.getByRole("heading", { name, level:1, exact:true }));
      await reflow(page);
      const active = page.locator('#primary-nav [aria-current="page"]');
      assert.match(await active.textContent(), new RegExp(name));
      if (width <= 1100) assert.equal(await button(page, "Menu").getAttribute("aria-expanded"), "false");
      if (width === 1440 || width === 390) await audit(page, width + " " + name);
    }
  }
  await navigateTo(page, "Finance", true);
  await page.goBack(); await focused(page.getByRole("heading", {name:"Knowledge Base",level:1}));
  await page.goForward(); await focused(page.getByRole("heading", {name:"Finance",level:1}));
  await page.reload(); await page.getByRole("heading", {name:"Finance",level:1}).waitFor();
  const animations = await page.locator(".section-view").evaluate(el => [getComputedStyle(el).animationName,
    getComputedStyle(document.querySelector(".sidebar nav a")).transitionDuration]);
  assert.deepEqual(animations, ["none","0s"]);
  const search = await page.getByRole("textbox", {name:"Global search"}).boundingBox();
  assert.ok(search.width >= 280 && search.height >= 44);
  const menu = button(page, "Menu");
  await menu.focus(); await page.keyboard.press("Enter");
  const nav = page.getByRole("navigation", {name:"Primary navigation"});
  await page.keyboard.press(nextControl); await focused(nav.getByRole("link",{name:"Mission Control",exact:true}));
  for (const b of await nav.getByRole("link").all()) {
    const bounds = await b.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
  }
  await audit(page, "Expanded phone navigation");
  await page.keyboard.press("Escape"); await focused(menu);
  assert.equal(await nav.isVisible(),false);
});

for (const [device, options] of [["desktop",desktop],["phone",phone]]) {
  test("keyboard, feedback, saved defaults and financial workflow on " + device, {timeout:90000}, async t => {
    const {page,db} = await workspace(t, options);
    await page.keyboard.press(nextControl); await focused(page.getByRole("link",{name:"Skip to main content"}));
    await page.keyboard.press("Enter"); await focused(page.getByRole("heading",{level:1}));
    const records = page.getByText("Workspace records",{exact:true});
    await records.focus(); await records.press("Enter");
    const collections = page.getByRole("group",{name:"Record collections"});
    for (const name of ["Daily journal","KPIs","Team members"]) {
      await collections.getByRole("button",{name:new RegExp("^" + name)}).click();
      await button(page,"＋ Add record").click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape"); await focused(button(page,"＋ Add record"));
    }
    await records.press("Enter");
    const add = button(page,"＋ Add Task");
    await add.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog",{name:"Add Task"});
    await focused(dialog.getByRole("heading",{name:"Add Task"}));
    await page.keyboard.press("Shift+" + nextControl); await focused(button(dialog,"Save record"));
    await page.keyboard.press(nextControl); await focused(button(dialog,"Close"));
    await page.keyboard.press(nextControl);
    const title = dialog.getByRole("textbox",{name:"Task",exact:true});
    await focused(title);
    const focusStyle = await title.evaluate(el => [getComputedStyle(el).outlineStyle, parseFloat(getComputedStyle(el).outlineWidth)]);
    assert.equal(focusStyle[0],"solid"); assert.ok(focusStyle[1]>=2);
    // Check text against the actual painted gradient immediately beside its label.
    const pixels = (await page.screenshot({scale:"css"})).toString("base64");
    const contrast = await dialog.locator('label[for="field-title"]').evaluate(async (label, png) => {
      const bitmap = new Image(); bitmap.src = "data:image/png;base64," + png; await bitmap.decode();
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap,0,0);
      const box = label.parentElement.getBoundingClientRect();
      const background = ctx.getImageData(Math.floor(box.right - 2), Math.floor(box.top + box.height/2),1,1).data;
      const text = getComputedStyle(label).color.match(/[\d.]+/g).map(Number);
      function luminance(rgb) {
        const [r,g,b] = Array.from(rgb, c => c/255).map(c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4);
        return 0.2126*r + 0.7152*g + 0.0722*b;
      }
      return (luminance(text) + 0.05) / (luminance(background) + 0.05);
    }, pixels);
    assert.ok(contrast >= 4.5, "Editor label contrast " + contrast);
    await page.evaluate(() => document.getElementById("global-search").focus());
    await focused(title);
    await page.keyboard.press("Control+Enter");
    await focused(title); assert.equal(await title.getAttribute("aria-invalid"),"true");
    assert.match(await title.getAttribute("aria-describedby"),/field-title-error/);
    assert.equal(await dialog.getByRole("alert").innerText(),"Check the highlighted fields before saving.");
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM tasks").first("n"),0);
    await audit(page,"Invalid task form");
    await title.fill("  "); await button(dialog,"Save record").click(); await focused(title);
    await title.fill("Follow up with founder"); await page.keyboard.press("Escape"); await focused(add);
    await add.press("Enter"); assert.equal(await title.inputValue(),"Follow up with founder");
    const [saved] = await Promise.all([post(page),title.press("Control+Enter")]);
    assert.ok(saved.ok()); await dialog.waitFor({state:"hidden"}); await focused(add);
    assert.match(await page.locator(".toast").innerText(),/saved/);

    const assistant = button(page,"Open AI command panel");
    await assistant.focus(); await assistant.press("Enter");
    const drawer = page.getByRole("dialog",{name:"AI Command Panel"});
    await focused(drawer.getByRole("heading",{name:"AI Command Panel"}));
    await button(drawer, "What should I focus on today?").click();
    assert.equal(await drawer.getByRole("textbox",{name:"Ask Founder OS"}).inputValue(),"What should I focus on today?");
    await audit(page,"Assistant drawer"); await page.keyboard.press("Escape"); await focused(assistant);
    assert.equal(await page.getByRole("textbox",{name:"Ask Founder OS"}).count(),0);
    const search = page.getByRole("textbox",{name:"Global search"});
    await search.fill("Follow up with founder"); await search.press(nextControl); await page.keyboard.press("Enter");
    await page.getByRole("dialog",{name:"Edit Follow up with founder"}).waitFor(); await page.keyboard.press("Escape"); await focused(search);

    await navigateTo(page,"Tasks",options.hasTouch);
    const actions = page.getByLabel("Actions for Follow up with founder");
    await actions.focus(); await actions.press("Enter");
    await page.keyboard.press(nextControl); await focused(button(page,"Open task"));
    await page.keyboard.press("Escape"); await focused(actions);
    assert.equal(await button(page,"Open task").isVisible(),false);
    await reflow(page);

    await navigateTo(page,"Clients",options.hasTouch); await button(page,"＋ Add Lead").click();
    const editor=page.getByRole("dialog");
    await editor.getByLabel("Contact name",{exact:true}).fill("Phase Five");
    const defaults = await Promise.all(["Lead status","Status","Urgency"].map(label => editor.getByLabel(label,{exact:true}).inputValue()));
    const lead = (await save(page)).data.leads[0];
    assert.deepEqual(defaults,["New","Open","Medium"]); assert.deepEqual([lead.stage,lead.status,lead.urgency],defaults);
    await navigateTo(page,"Finance",options.hasTouch); await button(page,"＋ Add Invoice").click();
    const issue = await editor.getByLabel("Issue date").inputValue();
    await editor.getByLabel("Subtotal").fill("120.50");
    const due = editor.getByLabel(/^Due date/);
    await due.fill("2000-01-01"); await button(editor,"Save record").click(); await focused(due);
    assert.equal(await due.getAttribute("aria-invalid"),"true"); await due.fill(issue);
    const invoice = await save(page);
    await page.locator(".manager-tabs").getByRole("button",{name:/Payments/}).click(); await button(page,"＋ Add record").click();
    await editor.getByLabel("Invoice",{exact:true}).selectOption(invoice.recordId);
    await editor.getByLabel("Amount",{exact:true}).fill("0"); await button(editor,"Save record").click(); await focused(editor.getByLabel("Amount",{exact:true}));
    await editor.getByLabel("Amount",{exact:true}).fill("20.50");
    const result = await save(page); assert.equal(result.metrics.outstanding,100);
    await page.reload(); assert.match(await page.locator(".metric").filter({hasText:"Cash due"}).innerText(),/100\.00/);
  });
}

test("drafts survive rapid exits and reloads, honour owner and parent, and protect local-only changes", {timeout:90000}, async t => {
  const {page,db,mf,url,session,serveFrom} = await workspace(t, phone);
  const add = button(page,"＋ Add Task"), dialog=page.getByRole("dialog");
  const task = dialog.getByLabel("Task",{exact:true});
  await page.evaluate(([legacy,foreign])=>{
    localStorage.setItem(legacy,JSON.stringify({title:"Unscoped draft"}));
    localStorage.setItem(foreign,JSON.stringify({title:"Other workspace draft"}));
  },["founder-os-draft:tasks:new", "founder-os-draft:foreign:tasks:new"]);
  await add.click(); assert.equal(await task.inputValue(),"");
  await task.fill("Founder’s rapid draft"); await page.reload(); await add.click();
  assert.equal(await task.inputValue(),"Founder’s rapid draft");
  await page.keyboard.press("Escape");
  const other = localWorker(t,"other"), otherDb = await other.getD1Database("DB","site");
  await migrate(otherDb); await otherDb.prepare("INSERT INTO workspace_owner VALUES (1,?,?)").bind(origin,"other").run();
  await session("other");
  const denied = await page.goto(url); assert.equal(denied.status(),403); assert.equal(await add.count(),0);
  await session("founder"); await page.goto(url); await add.click();
  await session("other"); serveFrom(other);
  const [switched] = await Promise.all([post(page), button(dialog,"Save record").click()]);
  assert.equal(switched.status(),403); assert.equal(await otherDb.prepare("SELECT COUNT(*) n FROM tasks").first("n"),0);
  await button(page,"Try again").click(); await add.click(); assert.equal(await task.inputValue(),"");
  await task.fill("Second founder"); await page.keyboard.press("Escape");
  serveFrom(mf); await session("founder"); await page.goto(url); await add.click();
  assert.equal(await task.inputValue(),"Founder’s rapid draft");
  const created = await save(page); assert.equal(await page.evaluate(k=>localStorage.getItem(k),keyOf("tasks")),null);
  await navigateTo(page,"Tasks",true);
  const record=page.locator(".record-main").filter({hasText:"Founder’s rapid draft"});
  await record.click(); await dialog.getByLabel("Notes",{exact:true}).fill("Author’s edit"); await page.keyboard.press("Escape");
  await db.prepare("UPDATE tasks SET title=?,updated_at=? WHERE id=?").bind("Newer task","2026-12-01T12:00:00.000Z",created.recordId).run();
  await page.reload(); await page.locator(".record-main").filter({hasText:"Newer task"}).click();
  assert.equal(await task.inputValue(),"Newer task"); assert.equal(await dialog.getByLabel("Notes",{exact:true}).inputValue(),"Author’s edit");
  assert.equal(await button(dialog,"Save record").isDisabled(),true);
  await button(dialog,"Use these edits with the latest version").click(); await save(page);
  assert.equal(await db.prepare("SELECT notes FROM tasks WHERE id=?").bind(created.recordId).first("notes"),"Author’s edit");

  await navigateTo(page,"Freelance Launch",true);
  for (const name of ["First objective","Second objective"]) {
    await page.getByRole("button",{name:/^Add objective/}).click(); await dialog.getByLabel("Objective",{exact:true}).fill(name); await save(page);
  }
  async function objectiveTask(name) {
    const card=page.locator(".objective-card").filter({hasText:name});
    if (await card.getAttribute("open") === null) await card.locator(":scope > summary").click();
    await button(card,"＋ Add task").click();
  }
  await objectiveTask("First objective"); await task.fill("Contextual task"); await page.keyboard.press("Escape");
  await objectiveTask("Second objective"); assert.equal(await task.inputValue(),""); await page.keyboard.press("Escape");
  await page.reload(); await objectiveTask("First objective"); assert.equal(await task.inputValue(),"Contextual task");
  page.once("dialog",d=>d.accept()); await button(dialog,"Discard draft").click(); await objectiveTask("First objective");
  assert.equal(await task.inputValue(),""); await page.keyboard.press("Escape");
  const objectiveId = await db.prepare("SELECT id FROM launch_objectives WHERE title=?").bind("First objective").first("id");
  const legacyKey = keyOf("tasks", JSON.stringify({objectiveId, sprintId:"", priority:"Low", dueDate:"2025-01-01"}));
  await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({title:"Earlier contextual draft"})),legacyKey);
  await objectiveTask("First objective"); assert.equal(await task.inputValue(),"Earlier contextual draft");
  await task.fill("Recovered contextual task"); await page.keyboard.press("Escape"); await objectiveTask("First objective");
  assert.equal(await task.inputValue(),"Recovered contextual task");
  const recovered = await save(page);
  assert.equal(recovered.data.tasks.find(row=>row.id===recovered.recordId).objectiveId,objectiveId);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),legacyKey),null);

  await navigateTo(page,"Knowledge Base",true); await page.locator(".manager-tabs").getByRole("button",{name:/Documents/}).click();
  await button(page,"＋ Add record").click(); await dialog.getByLabel("Document name",{exact:true}).fill("Founder brief");
  await dialog.getByLabel("Attachment",{exact:false}).setInputFiles({name:"brief.txt",mimeType:"text/plain",buffer:Buffer.from("draft")});
  page.once("dialog",d=>d.dismiss()); await page.keyboard.press("Escape"); assert.equal(await dialog.isVisible(),true);
  page.once("dialog",d=>d.accept()); await page.keyboard.press("Escape"); await button(page,"＋ Add record").click();
  assert.equal(await dialog.getByLabel("Document name",{exact:true}).inputValue(),"Founder brief");
  assert.equal(await dialog.locator('input[type=file]').inputValue(),"");
  await page.keyboard.press("Escape");
  await navigateTo(page,"Tasks",true); await add.click();
  await page.evaluate(()=>{
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if (this === localStorage && key.startsWith("founder-os-draft:")) throw new Error("Storage full");
      return write.call(this,key,value);
    };
  });
  await task.fill("Keep this edit"); assert.match(await dialog.getByRole("alert").innerText(),/storage is unavailable/);
  page.once("dialog",d=>d.dismiss()); await page.keyboard.press("Escape"); assert.equal(await task.inputValue(),"Keep this edit");
  await save(page);
});

test("a second tab cannot erase the first tab’s draft or corrupt a saved command", async t => {
  const {page,context,db,url} = await workspace(t,desktop);
  const second = await context.newPage(); await second.goto(url);
  await button(page,"＋ Add Task").click(); await button(second,"＋ Add Task").click();
  const firstEditor = page.getByRole("dialog"), otherEditor = second.getByRole("dialog");
  await firstEditor.getByLabel("Task",{exact:true}).fill("First tab draft");
  await otherEditor.getByLabel("Task",{exact:true}).fill("Second tab task");
  assert.match(await otherEditor.getByRole("alert").innerText(),/Another tab/);
  await save(second); await page.keyboard.press("Escape"); await button(page,"＋ Add Task").click();
  assert.equal(await firstEditor.getByLabel("Task",{exact:true}).inputValue(),"First tab draft");
  assert.equal(await db.prepare("SELECT title FROM tasks").first("title"),"Second tab task");
  await save(page);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),keyOf("tasks")),null);
  await navigateTo(page,"Clients");
  await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({name:"Existing founder draft",stage:"Prospect"})),keyOf("leads"));
  await button(page,"＋ Add Lead").click();
  assert.equal(await firstEditor.getByLabel("Contact name",{exact:true}).inputValue(),"Existing founder draft");
  assert.equal(await firstEditor.getByLabel("Lead status",{exact:true}).inputValue(),"New");
  await save(page);
});
