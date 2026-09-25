import Link from "next/link";
import { notFound } from "next/navigation";
import type * as React from "react";

import { AdminNav } from "@/components/admin-nav";
import { getAdminSession } from "@/lib/admin/require-admin";

/**
 * The admin console's gate and navigation, in one place.
 *
 * The gate lives here so the pages below it cannot forget it, and the nav lives
 * here so there is exactly one. A non-admin gets `notFound()`, not a 403: a
 * refusal would still tell them a console exists, and there is nothing a player
 * should be able to learn from an address they guessed.
 *
 * This is defence in depth, NOT the boundary. Every route keeps its own
 * `requireAdmin()`, and every page must be safe if this layout were somehow
 * bypassed — a layout is cached in the client across navigations, so it is a
 * convenience for the operator, never the thing standing between a player and
 * the data.
 */

// The gate reads the session cookie, so nothing here may be cached.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const admin = await getAdminSession();

  if (admin === null) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800 bg-stone-950/80">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <Link
              href="/admin"
              className="font-display text-xl leading-none font-semibold tracking-tight text-stone-100"
            >
              Prompt<span className="text-amber-400">Guard</span>
            </Link>
            <span aria-hidden="true" className="hidden h-4 w-px self-center bg-stone-700 sm:block" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-stone-500">
              admin console
            </span>
          </div>
          <p className="font-mono text-[11px] tracking-[0.1em] text-stone-400">{admin.email}</p>
        </div>
        <AdminNav />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
