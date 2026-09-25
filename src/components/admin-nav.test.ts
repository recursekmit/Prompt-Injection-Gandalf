import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nav is the one navbar for three pages, so what it links to is a contract:
 * a later task must not be able to drop a destination without failing here.
 *
 * `usePathname` is stubbed because these render without a router; the current
 * destination is the whole point of the component, so it is set per test.
 */

const mocks = vi.hoisted(() => ({
  pathname: { value: "/admin" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.value,
}));

import { ADMIN_DESTINATIONS, AdminNav, isCurrent } from "@/components/admin-nav";

const EXPECTED: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin", label: "Stats" },
  { href: "/admin/leaderboard", label: "Leaderboard" },
  { href: "/admin/users", label: "Users" },
];

function render(): string {
  return renderToStaticMarkup(h(AdminNav));
}

/** The one anchor marked current: its opening tag and its label. */
function currentAnchor(html: string): { tag: string; label: string } {
  const match = /<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/.exec(html);
  if (match === null || match[1] === undefined) {
    throw new Error("no destination was marked current");
  }
  return { tag: match[0], label: match[1] };
}

describe("AdminNav", () => {
  beforeEach(() => {
    mocks.pathname.value = "/admin";
  });

  it("declares the three destinations in order", () => {
    expect(ADMIN_DESTINATIONS).toEqual(EXPECTED);
  });

  it("renders every destination with its fixed href and label, in order", () => {
    const html = render();

    const positions = EXPECTED.map(({ href, label }) => {
      const hrefAt = html.indexOf(`href="${href}"`);
      const labelAt = html.indexOf(`>${label}</a>`);
      expect(hrefAt).toBeGreaterThanOrEqual(0);
      expect(labelAt).toBeGreaterThanOrEqual(0);
      return hrefAt;
    });

    // Ascending means the order on screen matches the order declared.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marks the current destination with aria-current and a non-colour state", () => {
    mocks.pathname.value = "/admin/users";

    const html = render();

    // Exactly one destination is current, and it is Users.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const current = currentAnchor(html);
    expect(current.label).toBe("Users");
    expect(current.tag).toContain('href="/admin/users"');

    // The state is not colour alone: it carries a heavier weight and a solid
    // underline, both of which survive a greyscale projector.
    expect(current.tag).toContain("font-semibold");
    expect(current.tag).toContain("border-amber-400");
  });

  it("does not light up Stats while a child of /admin is open", () => {
    mocks.pathname.value = "/admin/leaderboard";

    const html = render();

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const current = currentAnchor(html);
    expect(current.label).toBe("Leaderboard");
    expect(current.tag).toContain('href="/admin/leaderboard"');
  });
});

describe("isCurrent", () => {
  it("is exact, so a sub-route does not light its parent", () => {
    expect(isCurrent("/admin/users", "/admin")).toBe(false);
    expect(isCurrent("/admin", "/admin/users")).toBe(false);
  });

  it("treats a trailing slash as the same destination", () => {
    expect(isCurrent("/admin/", "/admin")).toBe(true);
    expect(isCurrent("/admin/users/", "/admin/users")).toBe(true);
  });

  it("matches a destination to itself", () => {
    expect(isCurrent("/admin/leaderboard", "/admin/leaderboard")).toBe(true);
  });
});
