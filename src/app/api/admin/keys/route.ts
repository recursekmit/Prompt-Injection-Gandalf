import { requireAdmin } from "@/lib/admin/require-admin";
import { describePool } from "@/lib/groq-key-pool";

/**
 * Admin-only view of Groq key-pool health: counts, cooldowns and availability
 * per key index. Returns no part of any API key, so it is safe to log.
 *
 * The gate moved to `@/lib/admin/require-admin` so the console's five routes
 * refuse identically; the status codes and bodies it returns are unchanged.
 */
export async function GET(): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.response;
  }

  return Response.json(await describePool(), { status: 200 });
}
