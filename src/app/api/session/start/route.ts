import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { NoWordsAvailableError, startOrResumeSession } from "@/lib/game/session-service";
import { TIERS, type Tier } from "@/lib/types";

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * Get-or-create the caller's session.
 *
 * Returns the existing IN_PROGRESS session when there is one, regardless of the
 * tier in the body, so a reload always resumes rather than silently starting a
 * new word.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const tier = (body as { tier?: unknown } | null)?.tier;
  if (!isTier(tier)) {
    return NextResponse.json({ error: "Unknown tier." }, { status: 400 });
  }

  try {
    const dto = await startOrResumeSession(session.user.id, tier);
    return NextResponse.json({ session: dto });
  } catch (error: unknown) {
    if (error instanceof NoWordsAvailableError) {
      return NextResponse.json(
        { error: "No words are available in that tier yet." },
        { status: 503 },
      );
    }
    console.error("session start failed", error);
    return NextResponse.json({ error: "Could not start a session." }, { status: 500 });
  }
}
