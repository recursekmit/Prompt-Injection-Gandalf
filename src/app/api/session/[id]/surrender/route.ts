import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { surrenderSession } from "@/lib/game/session-service";

/** A session leaves IN_PROGRESS without a win only here. There is no idle sweep. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const dto = await surrenderSession(session.user.id, id);
  if (dto === null) {
    return NextResponse.json({ error: "No live session to surrender." }, { status: 409 });
  }

  return NextResponse.json({ session: dto });
}

export const dynamic = "force-dynamic";
