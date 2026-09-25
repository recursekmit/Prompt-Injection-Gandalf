import Link from "next/link";
import { redirect } from "next/navigation";
import type * as React from "react";

import type { SessionStatus, Tier } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { HistoryEntryDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The exact shape the `select` below asks for. Declaring it here rather than
 * leaning on contextual typing means this file type-checks on its own terms:
 * the word text is dropped from anything downstream unless the session was won.
 */
interface SessionRow {
  readonly id: string;
  readonly tier: Tier;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
  readonly _count: { readonly attempts: number };
  readonly word: { readonly text: string };
}

const TIERS: readonly Tier[] = ["APPRENTICE", "ADEPT", "ARCHMAGE"];

const TIER_LABEL: Record<Tier, string> = {
  APPRENTICE: "Apprentice",
  ADEPT: "Adept",
  ARCHMAGE: "Archmage",
};

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "in progress";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const session = await auth();

  if (session === null) {
    redirect("/login");
  }

  const email = session.user?.email ?? "";
  if (email === "") {
    redirect("/login");
  }

  const rows: SessionRow[] = await prisma.gameSession.findMany({
    where: { user: { email } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tier: true,
      status: true,
      createdAt: true,
      endedAt: true,
      _count: { select: { attempts: true } },
      word: { select: { text: true } },
    },
  });

  // Mapped into the shared DTO shape and the word dropped unless the session was
  // actually won, so a word belonging to an unfinished session is never handed
  // to anything downstream of this component.
  const entries: HistoryEntryDto[] = rows.map((row) => ({
    id: row.id,
    tier: row.tier,
    status: row.status,
    wordText: row.status === "WON" ? row.word.text : null,
    attemptCount: row._count.attempts,
    startedAt: row.createdAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    durationMs: row.endedAt === null ? null : row.endedAt.getTime() - row.createdAt.getTime(),
  }));

  const stats: Record<Tier, { won: number; total: number }> = {
    APPRENTICE: { won: 0, total: 0 },
    ADEPT: { won: 0, total: 0 },
    ARCHMAGE: { won: 0, total: 0 },
  };
  for (const entry of entries) {
    stats[entry.tier].total += 1;
    if (entry.status === "WON") {
      stats[entry.tier].won += 1;
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800 bg-stone-900/40">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-stone-100">
            Prompt<span className="text-amber-400">Guard</span>
          </span>
          <Link
            href="/"
            className="text-sm text-stone-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
          >
            Back to the archive
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-100">Your record</h1>
        <p className="mt-2 text-sm text-stone-400">
          Every session you have opened, newest first.
        </p>

        <section aria-label="Wins by tier" className="mt-8 grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier) => {
            const { won, total } = stats[tier];
            return (
              <div
                key={tier}
                className="rounded-lg border border-stone-800 bg-stone-900/60 px-5 py-4"
              >
                <p className="font-mono text-[11px] uppercase tracking-widest text-stone-500">
                  {TIER_LABEL[tier]}
                </p>
                <p className="mt-2 text-2xl font-semibold text-stone-100">
                  {won}
                  <span className="text-base font-normal text-stone-500"> / {total}</span>
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {total === 0 ? "not yet attempted" : "wins out of sessions"}
                </p>
              </div>
            );
          })}
        </section>

        <section className="mt-12">
          {entries.length === 0 ? (
            <p className="rounded-lg border border-stone-800 bg-stone-900/40 px-5 py-6 text-sm text-stone-400">
              No sessions yet.{" "}
              <Link
                href="/"
                className="text-amber-300 underline-offset-4 hover:underline"
              >
                Choose a guardian
              </Link>{" "}
              to begin.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-stone-800">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead className="bg-stone-900/60">
                  <tr className="font-mono text-[11px] uppercase tracking-widest text-stone-500">
                    <th scope="col" className="px-5 py-3 font-normal">Tier</th>
                    <th scope="col" className="px-5 py-3 font-normal">Status</th>
                    <th scope="col" className="px-5 py-3 font-normal">Attempts</th>
                    <th scope="col" className="px-5 py-3 font-normal">Duration</th>
                    <th scope="col" className="px-5 py-3 font-normal">Word</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-stone-800/80">
                      <td className="px-5 py-3 text-stone-200">{TIER_LABEL[entry.tier]}</td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            entry.status === "WON"
                              ? "text-amber-300"
                              : entry.status === "ABANDONED"
                                ? "text-stone-500"
                                : "text-stone-300"
                          }
                        >
                          {entry.status === "IN_PROGRESS"
                            ? "in progress"
                            : entry.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-stone-300">
                        {entry.attemptCount}
                      </td>
                      <td className="px-5 py-3 text-stone-400">
                        {formatDuration(entry.durationMs)}
                      </td>
                      <td className="px-5 py-3">
                        {entry.wordText === null ? (
                          <span className="text-stone-600">—</span>
                        ) : (
                          <span className="font-mono text-amber-300">{entry.wordText}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
