import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level suite for the four endpoints under `/api/admin/users`.
 *
 * The gate and the service are both stubbed: the route's job is to turn their
 * verdicts into status codes and to pass arguments through unaltered, and the
 * arithmetic behind those verdicts is tested where it lives, in
 * `lib/admin/users.test.ts`.
 *
 * Two properties this suite exists for:
 *
 * - A refused gate returns the gate's own response and does NOT reach the
 *   service. A user list read for a signed-out caller would be the whole table
 *   of player emails.
 * - `AdminUsersError` is the REAL class (only the functions are replaced),
 *   because each route's `instanceof` compares against its own import; a
 *   hand-rolled lookalike would make every error branch untestable.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn<() => Promise<unknown>>(),
  listUsers: vi.fn<(query: unknown) => Promise<unknown>>(),
  createUser: vi.fn<(input: unknown) => Promise<unknown>>(),
  deleteUser: vi.fn<(userId: string) => Promise<unknown>>(),
  resetUserPassword: vi.fn<(userId: string, input: unknown) => Promise<unknown>>(),
  abandonLiveSession: vi.fn<(userId: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock("@/lib/admin/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/users")>();
  return {
    ...actual,
    listUsers: mocks.listUsers,
    createUser: mocks.createUser,
    deleteUser: mocks.deleteUser,
    resetUserPassword: mocks.resetUserPassword,
    abandonLiveSession: mocks.abandonLiveSession,
  };
});

// Keeps the real Prisma client, and therefore `@/lib/env`'s fail-fast
// validation, out of the import graph. `@/lib/env` is stubbed as well: the
// service imports it directly for the allowlist, and the failure it raises
// without a `DATABASE_URL` is not what this suite is about.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/env", () => ({
  env: { adminEmails: ["admin@example.com"] },
}));

const { AdminUsersError } = await import("@/lib/admin/users");
const listRoute = await import("@/app/api/admin/users/route");
const idRoute = await import("@/app/api/admin/users/[id]/route");
const passwordRoute = await import("@/app/api/admin/users/[id]/password/route");
const sessionRoute = await import("@/app/api/admin/users/[id]/session/route");

const ALLOWED = { ok: true, session: { userId: "admin_1", email: "admin@example.com" } };

/**
 * A fresh refusal per call. A `Response` body can only be read once, so a shared
 * instance would make the second test in a group fail for a reason that has
 * nothing to do with the route.
 */
function refused(): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** Every route, so the gate property is proven for all four, not just one. */
const ROUTES = [
  {
    name: "GET /api/admin/users",
    call: () => listRoute.GET(new Request("http://localhost/api/admin/users")),
  },
  {
    name: "POST /api/admin/users",
    call: () =>
      listRoute.POST(
        new Request("http://localhost/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: "new@example.com" }),
        }),
      ),
  },
  {
    name: "DELETE /api/admin/users/[id]",
    call: () =>
      idRoute.DELETE(new Request("http://localhost/api/admin/users/u9", { method: "DELETE" }), {
        params: Promise.resolve({ id: "u9" }),
      }),
  },
  {
    name: "POST /api/admin/users/[id]/password",
    call: () =>
      passwordRoute.POST(
        new Request("http://localhost/api/admin/users/u9/password", { method: "POST" }),
        { params: Promise.resolve({ id: "u9" }) },
      ),
  },
  {
    name: "DELETE /api/admin/users/[id]/session",
    call: () =>
      sessionRoute.DELETE(
        new Request("http://localhost/api/admin/users/u9/session", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u9" }) },
      ),
  },
];

describe("the admin users routes", () => {
  describe("the gate", () => {
    for (const route of ROUTES) {
      it(`${route.name} returns the gate's refusal untouched`, async () => {
        mocks.requireAdmin.mockResolvedValue(refused());

        const response = await route.call();

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
      });

      it(`${route.name} never reaches the service when refused`, async () => {
        mocks.requireAdmin.mockResolvedValue(refused());

        await route.call();

        for (const [name, service] of Object.entries(mocks)) {
          if (name === "requireAdmin") {
            continue;
          }
          expect(service, `${name} was called`).not.toHaveBeenCalled();
        }
      });
    }
  });

  describe("GET /api/admin/users", () => {
    beforeEach(() => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
    });

    it("passes the search, limit and cursor through as query strings", async () => {
      mocks.listUsers.mockResolvedValue({ users: [], nextCursor: null });

      await listRoute.GET(
        new Request("http://localhost/api/admin/users?q=ada&limit=10&cursor=ada%40example.com"),
      );

      expect(mocks.listUsers).toHaveBeenCalledWith({
        q: "ada",
        limit: "10",
        cursor: "ada@example.com",
      });
    });

    it("passes nulls, not empty strings, when the parameters are absent", async () => {
      mocks.listUsers.mockResolvedValue({ users: [], nextCursor: null });

      await listRoute.GET(new Request("http://localhost/api/admin/users"));

      expect(mocks.listUsers).toHaveBeenCalledWith({ q: null, limit: null, cursor: null });
    });

    it("returns the list as JSON", async () => {
      mocks.listUsers.mockResolvedValue({ users: [], nextCursor: "zoe@example.com" });

      const response = await listRoute.GET(new Request("http://localhost/api/admin/users"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ users: [], nextCursor: "zoe@example.com" });
    });
  });

  describe("POST /api/admin/users", () => {
    beforeEach(() => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
    });

    it("creates with 201 and returns the generated password exactly once", async () => {
      mocks.createUser.mockResolvedValue({
        user: { id: "u10", email: "new@example.com" },
        password: "tad04XDuEgo9",
      });

      const response = await listRoute.POST(
        new Request("http://localhost/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: "new@example.com" }),
        }),
      );

      expect(response.status).toBe(201);
      expect(mocks.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        password: undefined,
      });
      await expect(response.json()).resolves.toEqual({
        user: { id: "u10", email: "new@example.com" },
        password: "tad04XDuEgo9",
      });
    });

    it("rejects a body that is not JSON with 400 and does not call the service", async () => {
      const response = await listRoute.POST(
        new Request("http://localhost/api/admin/users", { method: "POST", body: "not json" }),
      );

      expect(response.status).toBe(400);
      expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("turns a duplicate email into the service's 409, not a 500", async () => {
      mocks.createUser.mockRejectedValue(new AdminUsersError("already has an account.", 409));

      const response = await listRoute.POST(
        new Request("http://localhost/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: "player@example.com" }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "already has an account." });
    });

    it("keeps a rejection message out of the body when the service returns 400", async () => {
      mocks.createUser.mockRejectedValue(new AdminUsersError("Enter a valid email address.", 400));

      const response = await listRoute.POST(
        new Request("http://localhost/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: "nope" }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Enter a valid email address." });
    });
  });

  describe("DELETE /api/admin/users/[id]", () => {
    beforeEach(() => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
    });

    it("reports what the deletion took with it", async () => {
      mocks.deleteUser.mockResolvedValue({
        email: "player@example.com",
        sessionsDeleted: 3,
        attemptsDeleted: 41,
      });

      const response = await idRoute.DELETE(
        new Request("http://localhost/api/admin/users/u9", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u9" }) },
      );

      expect(mocks.deleteUser).toHaveBeenCalledWith("u9");
      await expect(response.json()).resolves.toEqual({
        email: "player@example.com",
        sessionsDeleted: 3,
        attemptsDeleted: 41,
      });
    });

    /**
     * The one deletion that must never happen: an allowlisted account takes the
     * console's own login with it.
     */
    it("refuses an admin's account with the service's 409", async () => {
      mocks.deleteUser.mockRejectedValue(
        new AdminUsersError("That account is an admin and cannot be deleted.", 409),
      );

      const response = await idRoute.DELETE(
        new Request("http://localhost/api/admin/users/u1", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u1" }) },
      );

      expect(response.status).toBe(409);
    });
  });

  describe("POST /api/admin/users/[id]/password", () => {
    beforeEach(() => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
    });

    it("resets with a generated password when the body is empty", async () => {
      mocks.resetUserPassword.mockResolvedValue({
        email: "player@example.com",
        password: "OBhOOWjhEiAz",
      });

      const response = await passwordRoute.POST(
        new Request("http://localhost/api/admin/users/u9/password", { method: "POST" }),
        { params: Promise.resolve({ id: "u9" }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.resetUserPassword).toHaveBeenCalledWith("u9", { password: undefined });
      await expect(response.json()).resolves.toEqual({
        email: "player@example.com",
        password: "OBhOOWjhEiAz",
      });
    });

    it("passes a supplied password through to the service", async () => {
      mocks.resetUserPassword.mockResolvedValue({ email: "p@example.com", password: "chosen-one" });

      await passwordRoute.POST(
        new Request("http://localhost/api/admin/users/u9/password", {
          method: "POST",
          body: JSON.stringify({ password: "chosen-one" }),
        }),
        { params: Promise.resolve({ id: "u9" }) },
      );

      expect(mocks.resetUserPassword).toHaveBeenCalledWith("u9", { password: "chosen-one" });
    });

    it("surfaces a missing account as the service's 404", async () => {
      mocks.resetUserPassword.mockRejectedValue(new AdminUsersError("No such account.", 404));

      const response = await passwordRoute.POST(
        new Request("http://localhost/api/admin/users/gone/password", { method: "POST" }),
        { params: Promise.resolve({ id: "gone" }) },
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/users/[id]/session", () => {
    beforeEach(() => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
    });

    it("abandons the live session and names the player", async () => {
      mocks.abandonLiveSession.mockResolvedValue({ email: "player@example.com" });

      const response = await sessionRoute.DELETE(
        new Request("http://localhost/api/admin/users/u9/session", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u9" }) },
      );

      expect(mocks.abandonLiveSession).toHaveBeenCalledWith("u9");
      await expect(response.json()).resolves.toEqual({ email: "player@example.com" });
    });

    it("surfaces 'nothing live' as the service's 409", async () => {
      mocks.abandonLiveSession.mockRejectedValue(
        new AdminUsersError("That player has no session in progress.", 409),
      );

      const response = await sessionRoute.DELETE(
        new Request("http://localhost/api/admin/users/u9/session", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u9" }) },
      );

      expect(response.status).toBe(409);
    });
  });

  /**
   * The `refusalFor` helper rethrows anything that is not an `AdminUsersError`.
   * A Prisma failure reaching the client as a raw 500 body would be worse than
   * useless, so this pins that an unrecognised error is not dressed up as one:
   * it escapes the route, where Next turns it into a plain 500.
   */
  describe("an unrecognised failure", () => {
    it("is rethrown rather than answered as a 200", async () => {
      mocks.requireAdmin.mockResolvedValue(ALLOWED);
      mocks.createUser.mockRejectedValue(new Error("connection terminated"));

      await expect(
        listRoute.POST(
          new Request("http://localhost/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ email: "new@example.com" }),
          }),
        ),
      ).rejects.toThrow("connection terminated");
    });
  });
});
