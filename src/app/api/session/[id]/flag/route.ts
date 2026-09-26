import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { submitFlag } from "@/lib/game/session-service";

/**
 * Claim a level by submitting the flag. This is the ONLY win path: the attempt
 * route never marks a session WON on its own. The player extracts the flag from
 * the guardian's replies and submits it here, where it is exact-matched against
 * the real flag. A wrong guess is a plain 200 with `correct: false` — not an
 * error — so the composer can keep the session going.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const raw = (body as { flag?: unknown } | null)?.flag;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return NextResponse.json({ error: "A flag is required." }, { status: 400 });
  }

  const result = await submitFlag(session.user.id, id, raw);
  if (result === null) {
    return NextResponse.json(
      { error: "No live session to submit a flag to." },
      { status: 409 },
    );
  }

  if (!result.correct) {
    return NextResponse.json({
      correct: false,
      status: "IN_PROGRESS" as const,
      session: null,
      revealedWord: null,
    });
  }

  return NextResponse.json({
    correct: true,
    status: "WON" as const,
    session: result.session,
    revealedWord: result.session.revealedWord,
  });
}

export const dynamic = "force-dynamic";
