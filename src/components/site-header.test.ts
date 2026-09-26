import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The header is the way *into* the console, so the one thing that must hold is
 * that a non-admin never sees the link. Rendering it is the only way to be sure
 * the allowlist check is wired to the markup and not merely written.
 *
 * `next-auth/react` is stubbed so the sign-out button renders without a session
 * provider; `auth` and `@/lib/env` are stubbed for the same reason the gate's
 * own suite stubs them.
 */

interface SessionShape {
  user: { id?: string; email?: string | null };
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<SessionShape | null>>(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/env", () => ({
  env: { adminEmails: ["admin@example.com"] },
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { SiteHeader } from "@/components/site-header";

async function render(): Promise<string> {
  return renderToStaticMarkup(await SiteHeader());
}

describe("SiteHeader", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
  });

  it("shows the wordmark, the ledger and the email", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u2", email: "player@example.com" } });

    const html = await render();

    expect(html).toContain("Break The ");
    expect(html).toContain("Bot");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Ledger");
    expect(html).toContain("player@example.com");
    expect(html).toContain("Sign out");
  });

  it("offers the console to an allowlisted email", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "admin@example.com" } });

    const html = await render();

    expect(html).toContain('href="/admin"');
    expect(html).toContain("Admin");
  });

  it("hides the console link from a non-admin", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u2", email: "player@example.com" } });

    const html = await render();

    expect(html).not.toContain('href="/admin"');
  });

  it("hides the console link from a signed-out visitor", async () => {
    mocks.auth.mockResolvedValue(null);

    const html = await render();

    expect(html).not.toContain('href="/admin"');
  });
});
