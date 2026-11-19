import { createServer } from "node:http";
import { chromium, firefox, webkit } from "playwright-core";
import { migrate } from "../../scripts/migrations.mjs";
import { localWorker, origin } from "./workerd.mjs";

export const engineName = process.env.KEYSTONE_TEST_BROWSER ?? "chromium";

export async function founderBrowser(t, options, provider) {
  const engine = { chromium, firefox, webkit }[engineName];
  if (!engine) throw new Error("Unsupported KEYSTONE_TEST_BROWSER: " + engineName);
  const mf = localWorker(t, "fixture-founder", provider);
  const db = await mf.getD1Database("DB", "site");
  await migrate(db);
  await db.prepare("INSERT INTO workspace_owner VALUES (1,?,?)").bind(origin, "fixture-founder").run();
  const browser = await engine.launch(engine === chromium
    ? { args: ["--host-resolver-rules=MAP * ~NOTFOUND", "--no-proxy-server"] } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ ...options, isMobile: engine === firefox ? undefined : options.isMobile, serviceWorkers: "block" });
  let url = origin, worker = mf, loseNextAcknowledgement = null;
  async function dispatch(address, method, headers, bytes) {
    const pathname = new URL(address).pathname;
    const response = await worker.dispatchFetch(address, {method, headers, body:bytes});
    const body = Buffer.from(await response.arrayBuffer());
    if (pathname === loseNextAcknowledgement && method === "POST" && response.ok) {
      loseNextAcknowledgement = null;
      return null;
    }
    const responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
    delete responseHeaders["transfer-encoding"];
    return {status:response.status, headers:responseHeaders, body};
  }

  if (engine === webkit) {
    // WebKit's interception API omits cookies and the file parts of multipart
    // requests. Receive its actual HTTP bytes on loopback and pass those to
    // the same canonical HTTPS dispatcher used by the other browser tests.
    const server = createServer(async (req, res) => {
      try {
        const headers = new Headers(req.headers), chunks = [];
        if (headers.get("origin") === url) headers.set("origin", origin);
        for await (const chunk of req) chunks.push(chunk);
        const result = await dispatch(origin + req.url, req.method, headers, chunks.length ? Buffer.concat(chunks) : undefined);
        if (!result) { res.destroy(); return; }
        res.writeHead(result.status, result.headers); res.end(result.body);
      } catch { res.writeHead(502); res.end(); }
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    url = "http://127.0.0.1:" + server.address().port;
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    await context.route(address => address.origin !== url, route => route.abort());
  } else {
    await context.route("**/*", async route => {
      const req = route.request();
      if (new URL(req.url()).origin !== origin) return route.abort();
      const result = await dispatch(req.url(), req.method(), await req.allHeaders(), req.postDataBuffer() ?? undefined);
      return result ? route.fulfill(result) : route.abort("connectionreset");
    });
  }
  const session = value => context.addCookies([{ name:"fixture", value, url, httpOnly:true, secure:url.startsWith("https:") }]);
  await session("founder");
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return { mf, db, context, page, url, session, serveFrom(next) { worker = next; },
    loseAcknowledgement(path = "/api/data") { loseNextAcknowledgement = path; } };
}

export async function navigateTo(page, name, touch = false) {
  await page.getByRole("heading", {level: 1}).waitFor();
  const toggle = page.getByRole("button", {name: "Menu", exact: true});
  const activate = control => touch ? control.tap() : control.click();
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") await activate(toggle);
  const destination = page.getByRole("navigation", {name: "Primary navigation"}).getByRole("link", {name, exact: true});
  await activate(destination);
  await page.getByRole("heading", {name, level: 1, exact: true}).waitFor();
}
