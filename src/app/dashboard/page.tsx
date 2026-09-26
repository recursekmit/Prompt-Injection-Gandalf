import Link from "next/link";
import { redirect } from "next/navigation";
import type * as React from "react";

import { SiteHeader } from "@/components/site-header";
import type { SessionStatus } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { isLevelNumber } from "@/lib/guardian/levels";
import { prisma } from "@/lib/prisma";
import { identityFor } from "@/lib/seal-identities";
import type { HistoryEntryDto, LevelNumber } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The exact shape the `select` below asks for. Declaring it here rather than
 * leaning on contextual typing means this file type-checks on its own terms:
 * the word text is dropped from anything downstream unless the session was won.
 */
interface SessionRow {
  readonly id: string;
  /** A plain integer in the column, narrowed to a level before it becomes a DTO. */
  readonly level: number;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
  readonly _count: { readonly attempts: number };
  /** The per-user flag this session guarded; null only for legacy word-era rows. */
  readonly flag: { readonly value: string } | null;
  /** Legacy fallback for historic sessions created before per-user flags. */
  readonly word: { readonly text: string } | null;
}

const LEVEL_NUMBERS: readonly LevelNumber[] = [1, 2, 3];

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
      level: true,
      status: true,
      createdAt: true,
      endedAt: true,
      _count: { select: { attempts: true } },
      flag: { select: { value: true } },
      word: { select: { text: true } },
    },
  });

  // Mapped into the shared DTO shape and the word dropped unless the session was
  // actually won, so a word belonging to an unfinished session is never handed
  // to anything downstream of this component. A row whose level is outside the
  // game's range cannot be represented and is skipped rather than coerced.
  const entries: HistoryEntryDto[] = [];
  for (const row of rows) {
    const level = row.level;
    if (!isLevelNumber(level)) {
      continue;
    }
    entries.push({
      id: row.id,
      level,
      status: row.status,
      wordText: row.status === "WON" ? (row.flag?.value ?? row.word?.text ?? null) : null,
      attemptCount: row._count.attempts,
      startedAt: row.createdAt.toISOString(),
      endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
      durationMs: row.endedAt === null ? null : row.endedAt.getTime() - row.createdAt.getTime(),
    });
  }

  const stats = new Map<LevelNumber, { won: number; total: number }>(
    LEVEL_NUMBERS.map((level) => [level, { won: 0, total: 0 }]),
  );
  for (const entry of entries) {
    const bucket = stats.get(entry.level);
    if (bucket === undefined) {
      continue;
    }
    bucket.total += 1;
    if (entry.status === "WON") {
      bucket.won += 1;
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-[#050607] text-[#d0d7de]">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="terminal-tag font-mono uppercase tracking-[0.2em] text-[#5f6368]">
          YOUR_LEDGER // BREAK THE BOT
        </p>
        <h1 className="font-sans text-3xl font-extrabold tracking-tight text-white">
          Your record
        </h1>
        <p className="mt-2 text-sm text-[#9aa0a6]">
          Every session you have opened, newest first.
        </p>

        <section aria-label="Wins by level" className="mt-8 grid gap-4 sm:grid-cols-3">
          {LEVEL_NUMBERS.map((level) => {
            const { won, total } = stats.get(level) ?? { won: 0, total: 0 };
            return (
              <div key={level} className="recurse-card px-5 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5f6368]">
                  Level {level}
                </p>
                <p className="mt-1 text-lg leading-tight text-[#d0d7de]">
                  {identityFor(level).name}
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {won}
                  <span className="text-base font-normal text-[#5f6368]"> / {total}</span>
                </p>
                <p className="mt-1 text-xs text-[#5f6368]">
                  {total === 0 ? "not yet attempted" : "wins out of sessions"}
                </p>
              </div>
            );
          })}
        </section>

        <section className="mt-12">
          {entries.length === 0 ? (
            <p className="recurse-card px-5 py-6 text-sm text-[#9aa0a6]">
              No sessions yet.{" "}
              <Link
                href="/challenges"
                className="text-[#9efe00] underline-offset-4 hover:underline"
              >
                Choose a guardian
              </Link>{" "}
              to begin.
            </p>
          ) : (
            <div className="recurse-card overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead className="bg-[#0d0f12]">
                  <tr className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5f6368]">
                    <th scope="col" className="px-5 py-3 font-normal">Level</th>
                    <th scope="col" className="px-5 py-3 font-normal">Status</th>
                    <th scope="col" className="px-5 py-3 font-normal">Attempts</th>
                    <th scope="col" className="px-5 py-3 font-normal">Duration</th>
                    <th scope="col" className="px-5 py-3 font-normal">Word</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-[#1a1e23]">
                      <td className="px-5 py-3 text-[#d0d7de]">
                        Level {entry.level}
                        <span className="ml-2 text-[#5f6368]">
                          {identityFor(entry.level).name}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            entry.status === "WON"
                              ? "text-[#9efe00]"
                              : entry.status === "ABANDONED"
                                ? "text-[#5f6368]"
                                : "text-[#d0d7de]"
                          }
                        >
                          {entry.status === "IN_PROGRESS"
                            ? "in progress"
                            : entry.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[#d0d7de]">
                        {entry.attemptCount}
                      </td>
                      <td className="px-5 py-3 text-[#9aa0a6]">
                        {formatDuration(entry.durationMs)}
                      </td>
                      <td className="px-5 py-3">
                        {entry.wordText === null ? (
                          <span className="text-[#5f6368]">—</span>
                        ) : (
                          <span className="font-mono text-base text-[#adff00]">
                            {entry.wordText}
                          </span>
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
