"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

/**
 * The admin console's own navigation.
 *
 * One nav for three pages, rendered once by `src/app/admin/layout.tsx`. A nav
 * per page is the thing this exists to avoid: three copies drift, and the one
 * that is forgotten is the one that matters.
 *
 * A client component because `usePathname` is the simplest way to know which
 * destination is current. It holds no data and takes no props, so nothing
 * crosses the boundary that matters.
 */

interface Destination {
  readonly href: string;
  readonly label: string;
}

/** In display order: the stats screen the operator lives on comes first. */
export const ADMIN_DESTINATIONS: readonly Destination[] = [
  { href: "/admin", label: "Stats" },
  { href: "/admin/leaderboard", label: "Leaderboard" },
  { href: "/admin/users", label: "Users" },
];

/** Strips a trailing slash so `/admin/` and `/admin` are the same destination. */
function normalise(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Exact match, deliberately. A prefix test would light up both "Stats" and
 * "Users" on `/admin/users`, and a nav that marks two destinations current is
 * telling the operator nothing.
 */
export function isCurrent(pathname: string, href: string): boolean {
  return normalise(pathname) === normalise(href);
}

const BASE =
  "inline-flex items-center border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors";

/**
 * The current destination differs by more than colour: it carries a heavier
 * weight and a solid underline, so it survives a colourblind reader and a
 * washed-out projector alike. `aria-current` states it for assistive tech.
 */
function linkClasses(current: boolean): string {
  return current
    ? `${BASE} border-amber-400 font-semibold text-amber-200`
    : `${BASE} border-transparent font-normal text-stone-400 hover:border-stone-600 hover:text-stone-200`;
}

export function AdminNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin console" className="border-t border-stone-800/80">
      <ul className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-1 px-6">
        {ADMIN_DESTINATIONS.map((destination) => {
          const current = isCurrent(pathname, destination.href);
          return (
            <li key={destination.href}>
              <Link
                href={destination.href}
                aria-current={current ? "page" : undefined}
                className={linkClasses(current)}
              >
                {destination.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
