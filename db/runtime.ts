import { Buffer } from "node:buffer";
import { AsyncLocalStorage } from "node:async_hooks";
import { AccessError, accessResponse, founderSubject, siteOrigin } from "../app/chatgpt-auth";

import type { D1Database } from "@cloudflare/workers-types";

interface WorkspaceBucket {
  put(key: string, body: Blob, options: { httpMetadata: { contentType: string }; onlyIf?: { etagDoesNotMatch: string } }): Promise<{ etag: string } | null>;
  get(key: string): Promise<{ body: ReadableStream; etag: string } | null>;
}

export interface FounderRuntimeEnv {
  DB: D1Database;
  BUCKET: WorkspaceBucket;
  FOUNDER_USER_ID?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

const requestWorkspace = new AsyncLocalStorage<FounderRuntimeEnv & { workspaceId: string }>();

export function getRuntimeEnv() {
  const workspace = requestWorkspace.getStore();
  if (!workspace) throw new AccessError(401, "Authenticated workspace required");
  return workspace;
}

export async function withFounderWorkspace(
  request: Request, env: FounderRuntimeEnv, handle: () => Promise<Response>,
): Promise<Response> {
  try {
    const subject = founderSubject(request, env.FOUNDER_USER_ID);
    // The singleton is provisioned offline after ownership review. Never claim
    // an existing database on first login or derive ownership from seed rows.
    const owner = await env.DB.prepare(
      "SELECT subject, site_origin FROM workspace_owner WHERE slot = 1",
    ).first<{ subject: string; site_origin: string }>();
    if (owner?.subject !== subject || owner.site_origin !== siteOrigin) {
      throw new AccessError(403, "Workspace access denied");
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([siteOrigin, subject])));
    const workspaceId = Buffer.from(digest).toString("hex");
    const result = await requestWorkspace.run({
      DB: env.DB, BUCKET: env.BUCKET, OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_MODEL: env.OPENAI_MODEL, workspaceId,
    }, handle);
    const response = new Response(result.body, result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AccessError && error.status === 401 && request.method === "GET"
      && new URL(request.url).pathname === "/" && request.headers.get("accept")?.includes("text/html")) {
      return new Response('<!doctype html><title>Founder OS</title><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a>', {
        status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    return accessResponse(error);
  }
}
