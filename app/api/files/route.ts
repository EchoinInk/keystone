import { NextRequest, NextResponse } from "next/server";
import { getRuntimeEnv } from "../../../db/runtime";

export async function POST(request: NextRequest) {
  try {
    const env = getRuntimeEnv();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    return NextResponse.json({ name: file.name, objectKey: key, contentType: file.type || "application/octet-stream", size: file.size });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const env = getRuntimeEnv();
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing file key" }, { status: 400 });
  const object = await env.BUCKET.get(key);
  if (!object) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "content-disposition": `inline; filename="${key.split("/").pop()}"` } });
}
