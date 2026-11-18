// Vinext imports the optional Workers tracing binding at module load. Node
// fixtures supply their own per-request bindings. workerd loads the real module.
import { registerHooks } from "node:module";

export async function loadWorkerInNode() {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "cloudflare:workers") {
        return { shortCircuit: true, url: "data:text/javascript,export const tracing = undefined" };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    return (await import("../dist/server/index.js")).default;
  } finally {
    hooks.deregister();
  }
}
