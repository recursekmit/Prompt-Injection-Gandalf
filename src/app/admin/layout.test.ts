import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The layout is the console's second gate — the first being each route's own
 * `requireAdmin()`. It must refuse a non-admin with the not-found response (a
 * 403 would admit the console exists), and it must render the nav for an admin
 * so a later task cannot quietly drop a destination.
 *
 * `getAdminSession` is stubbed because this is about what the layout does with
 * its verdict, not how the verdict is reached; `notFound` is stubbed so the
 * test can assert it was the refusal chosen, without needing a Next runtime.
 */

const mocks = vi.hoisted(() => ({
  getAdminSession:
    vi.fn<() => Promise<{ userId: string; email: string } | null>>(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));

vi.mock("@/lib/admin/require-admin", () => ({
  getAdminSession: mocks.getAdminSession,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  usePathname: () => "/admin",
}));

import AdminLayout from "@/app/admin/layout";

const CHILDREN = h("p", null, "the page body");

describe("AdminLayout", () => {
  beforeEach(() => {
    mocks.getAdminSession.mockReset();
    mocks.notFound.mockClear();
  });

  it("renders the not-found response for a non-admin, not a refusal page", async () => {
    mocks.getAdminSession.mockResolvedValue(null);

    await expect(AdminLayout({ children: CHILDREN })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("renders the admin's email, the nav and the page for an admin", async () => {
    mocks.getAdminSession.mockResolvedValue({
      userId: "u1",
      email: "admin@example.com",
    });

    const html = renderToStaticMarkup(await AdminLayout({ children: CHILDREN }));

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(html).toContain("admin@example.com");
    expect(html).toContain("the page body");

    for (const href of ["/admin", "/admin/leaderboard", "/admin/users"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
