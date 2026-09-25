import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate is the only place the admin allowlist is read for a request, so the
 * property that matters is that its two entry points agree: `getAdminSession`
 * returns null in exactly the cases `requireAdmin` refuses. Two gates that
 * disagree is the failure this module exists to prevent.
 *
 * `auth` is stubbed because it is the session and the network; `@/lib/env` is
 * stubbed so the allowlist under test is declared here rather than inherited
 * from whatever `.env` the machine happens to have.
 */

interface SessionShape {
  user: { id?: string; email?: string | null };
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<SessionShape | null>>(),
  notFound: vi.fn<() => never>(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/env", () => ({
  env: { adminEmails: ["admin@example.com", "smoke@example.com"] },
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import { getAdminSession, requireAdmin, requireAdminPage } from "@/lib/admin/require-admin";

/** The refusal payload exactly as the pre-extraction admin route returned it. */
async function refusalOf(
  gate: Awaited<ReturnType<typeof requireAdmin>>,
): Promise<{ status: number; body: unknown }> {
  if (gate.ok) {
    throw new Error("expected a refusal");
  }
  return { status: gate.response.status, body: await gate.response.json() };
}

describe("the admin gate", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
  });

  it("gives an allowlisted session the admin's id and lowercased email", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "u1", email: "Admin@Example.COM" },
    });

    await expect(getAdminSession()).resolves.toEqual({
      userId: "u1",
      email: "admin@example.com",
    });

    const gate = await requireAdmin();
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.session).toEqual({ userId: "u1", email: "admin@example.com" });
    }
  });

  it("refuses a signed-out caller with 401 and the exact Unauthorized body", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(getAdminSession()).resolves.toBeNull();
    await expect(refusalOf(await requireAdmin())).resolves.toEqual({
      status: 401,
      body: { error: "Unauthorized" },
    });
  });

  it("refuses an authenticated non-admin with 403 and the exact Forbidden body", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u2", email: "player@example.com" } });

    await expect(getAdminSession()).resolves.toBeNull();
    await expect(refusalOf(await requireAdmin())).resolves.toEqual({
      status: 403,
      body: { error: "Forbidden" },
    });
  });

  it("refuses a session that carries no usable email or id", async () => {
    for (const session of [
      { user: { id: "u3", email: null } },
      { user: { id: "u4" } },
      { user: { email: "admin@example.com" } },
      { user: { id: "", email: "admin@example.com" } },
    ] satisfies SessionShape[]) {
      mocks.auth.mockResolvedValue(session);

      await expect(getAdminSession()).resolves.toBeNull();
      const refusal = await refusalOf(await requireAdmin());
      // A session exists, so this is a refusal about identity, not a 401.
      expect(refusal.status).toBe(403);
    }
  });

  describe("the page gate", () => {
    beforeEach(() => {
      mocks.notFound.mockClear();
    });

    /**
     * The bug this pins: `notFound()` in the layout returns 404 for an anonymous
     * request while the page's already-rendered subtree travels in the flight
     * payload. Measured against the dev server — an anonymous `GET /admin` whose
     * page queried the six level words returned 404 with all six words in the
     * body. The page gate has to run before the page reads anything, so the test
     * that matters is that a non-admin reaches `notFound` at all.
     */
    it("sends a non-admin to notFound and returns no session", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "u2", email: "player@example.com" } });

      await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.notFound).toHaveBeenCalledTimes(1);
    });

    it("sends a signed-out caller to notFound", async () => {
      mocks.auth.mockResolvedValue(null);

      await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.notFound).toHaveBeenCalledTimes(1);
    });

    it("returns the admin without calling notFound for an allowlisted email", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "u1", email: "Admin@Example.COM" } });

      await expect(requireAdminPage()).resolves.toEqual({
        userId: "u1",
        email: "admin@example.com",
      });
      expect(mocks.notFound).not.toHaveBeenCalled();
    });
  });

  describe("the two entry points agree", () => {
    const cases: ReadonlyArray<{ name: string; session: SessionShape | null }> = [
      { name: "signed out", session: null },
      { name: "an empty session", session: { user: {} } },
      { name: "a non-allowlisted email", session: { user: { id: "u2", email: "player@example.com" } } },
      { name: "an email that is a prefix of an admin's", session: { user: { id: "u5", email: "admin@example.co" } } },
      { name: "an allowlisted email", session: { user: { id: "u1", email: "smoke@example.com" } } },
    ];

    it.each(cases)("agrees for $name", async ({ session }) => {
      mocks.auth.mockResolvedValue(session);

      const adminSession = await getAdminSession();
      const gate = await requireAdmin();

      expect(adminSession === null).toBe(!gate.ok);
      if (adminSession !== null && gate.ok) {
        expect(gate.session).toEqual(adminSession);
      }
    });
  });
});
