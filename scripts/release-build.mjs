// A release can be rebuilt given the same private entropy, revision, toolchain
// and checkout path. Local one-off builds keep Vinext's per-build randomness.
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const cli = new URL("./cli.js", import.meta.resolve("vinext"));
process.argv = [process.execPath, fileURLToPath(cli), "build"];
const run = () => import(cli);
const secret = process.env.KEYSTONE_BUILD_KEY;
const revision = process.env.KEYSTONE_BUILD_REVISION;
if (secret === undefined && revision === undefined) {
  await run();
} else {
  if (!/^[0-9a-f]{64}$/i.test(secret ?? "") || !/^[0-9a-f]{40,64}$/i.test(revision ?? "")) {
    throw new Error("Reproducible releases require a 32-byte hex KEYSTONE_BUILD_KEY and a full KEYSTONE_BUILD_REVISION.");
  }
  const derive = (label, encoding = "hex") => createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`keystone/${revision}/${label}`).digest(encoding);
  process.env.__VINEXT_SHARED_BUILD_ID = revision;
  process.env.__VINEXT_SHARED_RSC_COMPATIBILITY_ID = revision;
  process.env.__VINEXT_SHARED_RSC_BUILD_IDENTITY = derive("rsc").slice(0, 32);
  process.env.__VINEXT_SHARED_PRERENDER_SECRET = derive("prerender");
  process.env.__VINEXT_SHARED_REVALIDATE_SECRET = derive("revalidation");
  process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ??= derive("actions", "base64");
  // Use the pinned Vinext build lifecycle's credential context for all Vite
  // environments. Keep preview keys distinct from one another and from actions.
  const { runWithPreviewBuildCredentials } = await import(new URL("./build/preview-credentials.js", cli));
  await runWithPreviewBuildCredentials(run, {
    id: derive("preview-id").slice(0, 32), signingKey: derive("preview-sign"), encryptionKey: derive("preview-encrypt"),
  });
}
