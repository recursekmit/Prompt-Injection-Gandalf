import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminUsersError, resetUserPassword } from "@/lib/admin/users";

/**
 * Resets a player's password, whether they asked for one or cannot remember it.
 * Works for any account, including another admin's — that is the recovery path.
 *
 * With no `password` in the body a fresh one is generated and returned. That is
 * the only time it exists in plaintext: only its bcrypt hash is stored, and no
 * read can return it again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is the common case: reset with a generated password.
    body = {};
  }

  const { password } = (body ?? {}) as { password?: unknown };

  try {
    return Response.json(await resetUserPassword(id, { password }), { status: 200 });
  } catch (error) {
    if (error instanceof AdminUsersError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
