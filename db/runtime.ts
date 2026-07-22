export type FounderRuntimeEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

declare global {
  // The Worker entry assigns bindings before Vinext dispatches each request.
  var __FOUNDER_OS_ENV__: FounderRuntimeEnv | undefined;
}

export function getRuntimeEnv(): FounderRuntimeEnv {
  if (!globalThis.__FOUNDER_OS_ENV__?.DB) throw new Error("Founder OS database is unavailable");
  return globalThis.__FOUNDER_OS_ENV__;
}
