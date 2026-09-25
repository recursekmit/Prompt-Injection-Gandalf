import { notFound } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * The single admin gate.
 *
 * Five admin routes are coming, and a gate copied five times is five places to
 * get it wrong — one of them eventually compares the wrong casing, or forgets
 * the refusal entirely. `requireAdmin` is therefore the only place the
 * allowlist is read for a request, and `getAdminSession` is the same decision
 * without the response, for the page layout that has to render a refusal
 * rather than return one.
 *
 * The two must agree: `getAdminSession()` returns null in exactly the cases
 * `requireAdmin()` refuses. They share one helper so they cannot drift.
 *
 * `ADMIN_EMAILS` is lowercased once in `@/lib/env`, so the comparison here is
 * case-insensitive by construction.
 */

export type AdminSession = { userId: string; email: string };

/**
 * A signed-in session's user, if it is an admin. Null covers both "not signed
 * in" and "signed in but not allowlisted" — the caller that needs to tell them
 * apart asks `auth()` for the session itself.
 */
function adminFrom(session: Session | null): AdminSession | null {
  if (session === null) {
    return null;
  }

  // Declared as possibly-absent rather than trusted: the token is minted by
  // the jwt callback, but a session that reaches a gate without an id is not
  // one to hand admin powers to.
  const userId: string | undefined = session.user.id;
  const rawEmail: string | null | undefined = session.user.email;
  if (typeof userId !== "string" || userId === "") {
    return null;
  }
  if (typeof rawEmail !== "string" || rawEmail === "") {
    return null;
  }

  const email = rawEmail.toLowerCase();
  if (!env.adminEmails.includes(email)) {
    return null;
  }

  return { userId, email };
}

/** The signed-in admin, or null. Never throws and never refuses by itself. */
export async function getAdminSession(): Promise<AdminSession | null> {
  return adminFrom(await auth());
}

/**
 * The gate for a PAGE, and the reason it must be the first statement of one.
 *
 * Measured, not assumed: with the layout calling `notFound()` and the page
 * fetching and rendering the six level words, an anonymous `GET /admin` returned
 * 404 **with every word in the flight payload** (compass, lantern, crucible,
 * penumbra, palimpsest, defenestration — reproduced). Next renders the page's
 * subtree to build the response before the layout's `notFound()` aborts it, so a
 * layout gate changes the status code and withholds nothing. A gate that runs
 * after the query has already leaked its data.
 *
 * So each page gates itself, before it reads anything:
 *
 *     const admin = await requireAdminPage();
 *     const data = await loadTheSecretThing();
 *
 * With the same fetch behind this gate, the words are absent from the 404 body.
 * That is the whole difference, and it is why this helper exists rather than
 * each page remembering the two lines above.
 *
 * `notFound` is typed as `never`, so the return below is reachable code the
 * compiler is happy with, and callers get a non-null session with no cast.
 */
export async function requireAdminPage(): Promise<AdminSession> {
  const admin = await getAdminSession();

  if (admin === null) {
    notFound();
  }

  return admin;
}

/**
 * The gate for route handlers: an admin session, or the refusal to return.
 *
 * The two refusal payloads are byte-for-byte what the pre-extraction admin
 * route returned, so extracting this changed no caller's contract.
 */
export async function requireAdmin(): Promise<
  { ok: true; session: AdminSession } | { ok: false; response: Response }
> {
  const session = await auth();

  if (session === null) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = adminFrom(session);
  if (admin === null) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, session: admin };
}
