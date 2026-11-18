// Sites dispatch owns sign-in, session expiry and the site-scoped subject header.
// Only the private dispatch deployment at this exact origin may use this issuer.
export const siteOrigin = "https://echo-in-ink-founder-os.echoinink.chatgpt.site";

export class AccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function founderSubject(request: Request, admittedSubject?: string): string {
  if (new URL(request.url).origin !== siteOrigin) {
    throw new AccessError(403, "Use the private Founder OS site");
  }
  const subject = request.headers.get("oai-authenticated-user-id");
  if (!subject) throw new AccessError(401, "Sign in with ChatGPT");
  if (!admittedSubject) throw new AccessError(503, "Founder admission is pending");
  if (subject !== admittedSubject) throw new AccessError(403, "Workspace access denied");
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== siteOrigin) {
    throw new AccessError(403, "Same-origin request required");
  }
  return subject;
}

export function accessResponse(error: unknown): Response {
  const known = error instanceof AccessError;
  return Response.json({ error: known ? error.message : "Workspace unavailable" }, {
    status: known ? error.status : 503,
    headers: { "cache-control": "private, no-store" },
  });
}
