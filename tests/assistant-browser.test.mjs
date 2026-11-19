import assert from "node:assert/strict";
import test from "node:test";
import { engineName, founderBrowser, navigateTo } from "./fixtures/browser.mjs";
import { providerAnswer } from "./fixtures/assistant.mjs";

test(`founder reviews, declines and approves assistant requests and reopens the exact transcript in ${engineName}`, {timeout:90_000}, async t => {
  const sent = [];
  let unavailable = false;
  const { page, db, url, session, loseAcknowledgement } = await founderBrowser(t, {viewport:{width:390,height:844}}, async request => {
    sent.push((await request.json()).input);
    return unavailable ? new Response(null,{status:503}) : providerAnswer("Review the approved milestone.");
  });
  await db.prepare("INSERT INTO tasks(id,title,notes,created_at,updated_at) VALUES('t','Design review','private notes','2026-01-01','2026-01-01')").run();
  await page.goto(url);
  const launch = page.getByRole("button",{name:"Open AI command panel"});
  const drawer = page.getByRole("dialog",{name:"AI Command Panel"});
  const ask = drawer.getByRole("textbox",{name:"Ask Founder OS"});
  const review = drawer.getByRole("button",{name:"Review OpenAI request"});
  const approve = host => host.getByRole("button",{name:"Approve and send to OpenAI"});
  const status = async (host, label) => {
    try { await host.getByText(label,{exact:true}).waitFor(); }
    catch (error) {
      t.diagnostic(await host.innerText());
      t.diagnostic(JSON.stringify({providerCalls:sent.length, saved:(await db.prepare("SELECT provider_status,provider_issue FROM ai_conversations").all()).results}));
      throw error;
    }
  };

  await launch.click();
  await ask.fill("Keep the first question local");
  loseAcknowledgement("/api/assistant");
  await drawer.getByRole("button",{name:"Get local suggestion"}).click();
  await drawer.getByRole("alert").waitFor();
  await drawer.getByRole("button",{name:"Get local suggestion"}).click();
  await status(drawer,"Rules-based suggestion");
  assert.equal(await db.prepare("SELECT count(*) n FROM ai_conversations").first("n"),1);
  assert.equal(sent.length,0);
  await ask.fill("A question to decline");
  await review.click();
  await status(drawer,"OpenAI request awaiting approval");
  await drawer.getByRole("button",{name:"Decline and keep local"}).click();
  await status(drawer,"OpenAI request declined");
  assert.equal(sent.length,0);

  await ask.fill("Review the milestone");
  await review.click();
  await status(drawer,"OpenAI request awaiting approval");
  const preview = await drawer.getByRole("region",{name:"Question and records to share"}).innerText();
  assert.match(preview,/Design review/);
  assert.doesNotMatch(preview,/private notes/);
  await page.reload();
  await launch.click();
  await drawer.getByLabel("Saved conversations").selectOption({label:"Mission Control · Review the milestone"});
  await status(drawer,"OpenAI request awaiting approval");
  assert.equal(sent.length,0);
  loseAcknowledgement("/api/assistant");
  await approve(drawer).click();
  await status(drawer,"OpenAI request completed");
  await status(drawer,"Review the approved milestone.");
  assert.deepEqual(sent,[preview]);
  assert.equal(await approve(drawer).count(),0);

  await ask.fill("Another provider question");
  await review.click();
  await status(drawer,"OpenAI request awaiting approval");
  unavailable = true;
  await approve(drawer).click();
  await status(drawer,"OpenAI request failed");
  await status(drawer,"OpenAI is unavailable.");
  assert.match(await drawer.locator(".assistant-answer").innerText(),/Local suggestion[\s\S]*Design review/);
  assert.ok(await drawer.getByRole("button",{name:"Get local suggestion"}).isEnabled());
  assert.equal(sent.length,2);
  await drawer.getByRole("button",{name:"Close",exact:true}).click();
  await page.reload();
  await navigateTo(page,"Activity");
  await page.getByRole("button",{name:"AI",exact:true}).click();
  await page.locator(".timeline").getByRole("button",{name:/Review the milestone/}).click();
  const transcript = page.getByRole("dialog",{name:"AI conversation"});
  await status(transcript,"Review the milestone");
  await status(transcript,"OpenAI request completed");
  await status(transcript,"Review the approved milestone.");
  assert.equal(await db.prepare("SELECT count(*) n FROM ai_conversations").first("n"),4);
  await transcript.getByRole("button",{name:"Close",exact:true}).click();
  await launch.click();
  await ask.fill("Keep this pending request private");
  await review.click();
  await status(drawer,"OpenAI request awaiting approval");
  await session("expired");
  await approve(drawer).click();
  await page.getByRole("alert").filter({hasText:"Sign in with ChatGPT"}).waitFor();
  await page.reload();
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(await page.getByText("Review the approved milestone.").count(),0);
  assert.equal(sent.length,2);
});
