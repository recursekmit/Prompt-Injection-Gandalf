import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isLevelNumber } from "@/lib/guardian/levels";
import {
  NoWordsAvailableError,
  getProgress,
  startOrResumeSession,
} from "@/lib/game/session-service";

/**
 * Get-or-create the caller's session at the requested level.
 *
 * Returns the existing IN_PROGRESS session when there is one, regardless of the
 * level in the body, so a reload always resumes rather than silently starting a
 * new word.
 *
 * The requested level is checked against derived progress rather than trusted:
 * a player may not skip ahead to a locked level, and may not replay a beaten
 * one. Both are 409s, because the request is understood and refused on the
 * game's rules rather than being malformed.
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

  const level = (body as { level?: unknown } | null)?.level;
  if (!isLevelNumber(level)) {
    return NextResponse.json(
      { error: "A level number from 1 to 6 is required." },
      { status: 400 },
    );
  }

  const progress = await getProgress(session.user.id);

  // Checked before the comparisons below: with every level beaten,
  // `currentLevel` is level 6, which is itself beaten, so the locked and
  // already-beaten tests cannot distinguish this state on their own.
  if (progress.levels.every((levelProgress) => levelProgress.status === "COMPLETED")) {
    return NextResponse.json({ error: "You have beaten every level." }, { status: 409 });
  }
  if (level > progress.currentLevel) {
    return NextResponse.json(
      { error: `That level is locked. Beat level ${progress.currentLevel} first.` },
      { status: 409 },
    );
  }
  if (level < progress.currentLevel) {
    return NextResponse.json(
      { error: "You have already beaten that level." },
      { status: 409 },
    );
  }

  try {
    const dto = await startOrResumeSession(session.user.id, level);
    return NextResponse.json({ session: dto });
  } catch (error: unknown) {
    if (error instanceof NoWordsAvailableError) {
      return NextResponse.json(
        { error: "No words are available at that level yet." },
        { status: 503 },
      );
    }
    console.error("session start failed", error);
    return NextResponse.json({ error: "Could not start a session." }, { status: 500 });
  }
}
