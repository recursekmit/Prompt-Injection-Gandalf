import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminUsersError, abandonLiveSession } from "@/lib/admin/users";

/**
 * Abandons a player's live session — the "they are stuck" remedy.
 *
 * Their next visit starts the current level fresh, with no history from the
 * session that got them wedged. Their wins are untouched: this clears a level's
 * conversation, not their progress through the game.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  try {
    return Response.json(await abandonLiveSession(id), { status: 200 });
  } catch (error) {
    if (error instanceof AdminUsersError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
