import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { describePool } from "@/lib/groq-key-pool";

/**
 * Admin-only view of Groq key-pool health: counts, cooldowns and availability
 * per key index. Returns no part of any API key, so it is safe to log.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user?.email?.toLowerCase();
  if (email === undefined || !env.adminEmails.includes(email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json(await describePool(), { status: 200 });
}
