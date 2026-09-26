import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearGroqKey, hasGroqKey, storeGroqKey, validateGroqKey } from "@/lib/account/groq-key";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ hasKey: await hasGroqKey(session.user.id) });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const apiKey = (body as { apiKey?: unknown } | null)?.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return NextResponse.json({ error: "A Groq API key is required." }, { status: 400 });
  }
  if (!(await validateGroqKey(apiKey.trim()))) {
    return NextResponse.json({ error: "Groq rejected that key." }, { status: 400 });
  }
  await storeGroqKey(session.user.id, apiKey.trim());
  return NextResponse.json({ hasKey: true });
}

export async function DELETE(): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await clearGroqKey(session.user.id);
  return NextResponse.json({ hasKey: false });
}

export const dynamic = "force-dynamic";
