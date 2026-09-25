import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminUsersError, createUser, listUsers } from "@/lib/admin/users";

/**
 * The console's user list and its "add a player" button.
 *
 * The gate protects the route; the page that renders this protects itself
 * separately, because the layout's `notFound()` only changes the status code and
 * still ships whatever the page read. See lib/admin/require-admin.ts.
 */

function refusalFor(error: unknown): Response {
  if (error instanceof AdminUsersError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  const url = new URL(request.url);
  const list = await listUsers({
    q: url.searchParams.get("q"),
    limit: url.searchParams.get("limit"),
    cursor: url.searchParams.get("cursor"),
  });

  return Response.json(list, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };

  try {
    const created = await createUser({ email, password });
    // The only time this password exists in plaintext. It is not logged, and no
    // later read of this user can return it again.
    return Response.json(created, { status: 201 });
  } catch (error) {
    return refusalFor(error);
  }
}
