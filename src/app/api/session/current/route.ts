import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProgress } from "@/lib/game/session-service";

/**
 * The player's whole progression: every level's status, which one is current,
 * and the live session with its full attempt history, so a reload or a fresh
 * login rebuilds the conversation exactly. `session: null` means there is no
 * live session to resume and the player should be offered the current level.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json(await getProgress(session.user.id));
}
