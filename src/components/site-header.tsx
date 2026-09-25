import Link from "next/link";
import type * as React from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * The site header — the chrome above the game and the ledger.
 *
 * It carries the way *into* the console and nothing else: the `Admin` link is
 * rendered only for an allowlisted email, so a player never sees that a console
 * exists. That is presentation, not access control: `/admin` refuses a
 * non-admin independently, whether or not the link was rendered.
 *
 * A server component, and prop-free: it reads the session and the allowlist
 * itself, so the two screens that show it (the game and the ledger) cannot
 * disagree about who is an admin, and neither has to thread a flag down.
 */
export async function SiteHeader(): Promise<React.JSX.Element> {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const isAdmin = email !== "" && env.adminEmails.includes(email.toLowerCase());

  return (
    <header className="border-b border-stone-800 bg-stone-950/80">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl leading-none font-semibold tracking-tight text-stone-100">
            Prompt<span className="text-amber-400">Guard</span>
          </span>
          <span aria-hidden="true" className="hidden h-4 w-px self-center bg-stone-700 sm:block" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-stone-500">
            THE SEALED ARCHIVE
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {/*
            Both destinations, on both screens. The two screens used to carry a
            link to each *other* — the game showed `Ledger`, the ledger showed
            `The seals` — so extracting the header into one component quietly
            made the ledger a dead end: a player with sessions got a link back
            to the page they were already on, and no way back to the game. The
            ledger's "Choose a guardian" link only renders in its empty state.
            Showing both is the fix; a nav link to where you already are is
            ordinary, a screen you cannot leave is not.
          */}
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
          >
            The seals
          </Link>
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
          >
            Ledger
          </Link>
          {email !== "" ? (
            <span className="hidden text-stone-500 sm:inline">{email}</span>
          ) : null}
          {isAdmin ? (
            <Link
              href="/admin"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
            >
              Admin
            </Link>
          ) : null}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
