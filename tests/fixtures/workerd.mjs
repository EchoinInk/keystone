import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

export const origin = "https://echo-in-ink-founder-os.echoinink.chatgpt.site";

export function localWorker(t, admittedFounder = "fixture-founder") {
  const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const modules = readdirSync(root, { recursive: true }).filter(name => name.endsWith(".js"));
  const compatibility = { compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"] };
  const mf = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", cf: false,
    workers: [
      {
        ...compatibility, name: "dispatch-fixture", modules: true, serviceBindings: { SITE: "site" },
        // Model the Sites boundary using synthetic sessions on a loopback Worker.
        script: `export default { fetch(request, env) {
          const headers = new Headers(request.headers);
          headers.delete("oai-authenticated-user-id");
          headers.set("host", new URL(request.url).host);
          const session = headers.get("cookie");
          if (session === "fixture=founder") headers.set("oai-authenticated-user-id", "fixture-founder");
          if (session === "fixture=other") headers.set("oai-authenticated-user-id", "other");
          return env.SITE.fetch(new Request(request, { headers }));
        } };`,
      },
      {
        ...compatibility, name: "site", modulesRoot: root,
        modules: modules.sort((a, b) => Number(b === "index.js") - Number(a === "index.js"))
          .map(name => ({ type: "ESModule", path: resolve(root, name), contents: readFileSync(resolve(root, name), "utf8") })),
        d1Databases: ["DB"], r2Buckets: ["BUCKET"], bindings: { FOUNDER_USER_ID: admittedFounder },
        serviceBindings: { ASSETS: request => {
          const directory = fileURLToPath(new URL("../../dist/client/", import.meta.url));
          const pathname = new URL(request.url).pathname;
          const asset = resolve(directory, "." + pathname);
          if (!asset.startsWith(directory) || !existsSync(asset) || !statSync(asset).isFile()) return new Response(null, { status: 404 });
          const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
          return new Response(readFileSync(asset), { headers: { "content-type": types[extname(asset)] ?? "application/octet-stream" } });
        } },
        outboundService: () => new Response(null, { status: 403 }),
      },
    ],
  }));
  t.after(() => mf.dispose());
  return mf;
}
