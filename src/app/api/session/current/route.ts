import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveSessionDto } from "@/lib/game/session-service";

/**
 * The active session with its full attempt history, so a reload or a fresh login
 * rebuilds the conversation exactly. `{ session: null }` means the player has no
 * live session and should be shown the tier picker.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const dto = await getActiveSessionDto(session.user.id);
  return NextResponse.json({ session: dto });
}
