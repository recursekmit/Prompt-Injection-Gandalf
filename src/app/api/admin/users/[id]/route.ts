import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminUsersError, deleteUser } from "@/lib/admin/users";

/**
 * Deletes a player, their sessions and their attempts.
 *
 * Refuses (409) any account whose email is in `ADMIN_EMAILS`: this route is the
 * one that could delete the console's own account, and an allowlisted address is
 * the only thing standing between the event and being locked out of its own
 * admin screen.
 *
 * The response reports how many sessions and attempts went with them, so the
 * caller can show that a mistyped address created a minute ago and an account
 * with forty attempts behind it are not the same deletion.
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
    return Response.json(await deleteUser(id), { status: 200 });
  } catch (error) {
    if (error instanceof AdminUsersError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
