import { loadLeaderboard } from "@/lib/admin/leaderboard";
import { requireAdmin } from "@/lib/admin/require-admin";

/**
 * The leaderboard, admin-only.
 *
 * Admin-only because the only identity the schema stores is the email address,
 * and a room-wide list of 150 addresses is not something to hand to a player.
 *
 * The gate here protects the route. The page that renders this protects itself
 * separately, and it must: the layout's `notFound()` was measured shipping a
 * page's rendered data inside the body of its 404, so it is a status-code gate,
 * not a data gate.
 */
export async function GET(): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  return Response.json(await loadLeaderboard(), { status: 200 });
}
