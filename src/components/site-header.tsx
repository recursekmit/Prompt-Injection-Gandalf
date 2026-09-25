import Link from "next/link";
import type * as React from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * The site header — the chrome above every screen, public and private alike.
 *
 * It is now public-aware: a signed-out visitor sees the way to the leaderboard
 * and a sign-in call, while a signed-in player also gets the ledger and, for an
 * allowlisted email, the console. The `Admin` link is rendered only for an
 * allowlisted email, so a player never sees that a console exists. That is
 * presentation, not access control: `/admin` refuses a non-admin independently,
 * whether or not the link was rendered.
 *
 * A server component, and prop-free: it reads the session and the allowlist
 * itself, so every screen that shows it cannot disagree about who is signed in
 * or who is an admin, and none has to thread a flag down.
 */
export async function SiteHeader(): Promise<React.JSX.Element> {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const signedIn = email !== "";
  const isAdmin = signedIn && env.adminEmails.includes(email.toLowerCase());

  const navLink =
    "font-mono text-[11px] uppercase tracking-[0.2em] text-[#9aa0a6] underline-offset-4 transition-colors hover:text-[#9efe00] hover:underline";

  return (
    <header className="border-b border-[#1a1e23] bg-[#050607]/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-xl leading-none font-extrabold tracking-tight text-white">
            Prompt<span className="text-[#9efe00]">Guard</span>
          </span>
          <span aria-hidden="true" className="hidden h-4 w-px self-center bg-[#22272e] sm:block" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-[#5f6368] sm:inline">
            THE SEALED ARCHIVE
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/challenges" className={navLink}>
            Challenges
          </Link>
          <Link href="/leaderboard" className={navLink}>
            Leaderboard
          </Link>
          {signedIn ? (
            <Link href="/dashboard" className={navLink}>
              Ledger
            </Link>
          ) : null}
          {isAdmin ? (
            <Link
              href="/admin"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9efe00] underline-offset-4 transition-colors hover:text-[#adff00] hover:underline"
            >
              Admin
            </Link>
          ) : null}
          {signedIn ? (
            <>
              <span className="hidden text-[#5f6368] sm:inline">{email}</span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-sm border border-[rgba(158,254,0,0.35)] bg-[rgba(158,254,0,0.12)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#9efe00] transition-colors hover:bg-[rgba(158,254,0,0.2)]"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
