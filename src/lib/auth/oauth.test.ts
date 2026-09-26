import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert } } }));

import { upsertGithubUser } from "@/lib/auth/oauth";

describe("upsertGithubUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts by email and returns the db id", async () => {
    upsert.mockResolvedValueOnce({ id: "db-1" });
    await expect(upsertGithubUser("a@b.com")).resolves.toBe("db-1");
    expect(upsert).toHaveBeenCalledWith({
      where: { email: "a@b.com" },
      update: {},
      create: { email: "a@b.com" },
      select: { id: true },
    });
  });
});
