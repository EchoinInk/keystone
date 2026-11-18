import assert from "node:assert/strict";
import test from "node:test";
import { call, fixture } from "./fixtures/workspace.mjs";

test("renders development preview metadata for the admitted founder", async () => {
  const { env } = fixture();
  const response = await call(env, "/", { user: env.FOUNDER_USER_ID, headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i);
});
