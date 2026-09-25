import Link from "next/link";
import type * as React from "react";

import { loadLeaderboard } from "@/lib/admin/leaderboard";
import { LEADERBOARD_LEVELS } from "@/lib/admin/ranking";
import { requireAdminPage } from "@/lib/admin/require-admin";
import type { LeaderboardLevelCell, LeaderboardRow } from "@/lib/types";

/**
 * The room's standings, admin-only.
 *
 * `requireAdminPage()` is the FIRST statement and it must stay there. The
 * layout's own gate only changes the status code: Next renders this page's
 * subtree before the layout aborts it, so a read that happens before the gate
 * travels to the client inside the body of a 404. Here that would be every
 * player's email address.
 *
 * Rows are capped by default with a server-rendered "show all" (a search
 * param, so no client state and no JavaScript): 150 rows is a lot to scroll
 * past, and the cap must never be silent — the count above it says what is
 * shown.
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;

function isShowAll(searchParams: { all?: string }): boolean {
  return searchParams.all === "1";
}

/** `✓` for a win, the attempt count otherwise, and a dash for untouched. */
function cellLabel(cell: LeaderboardLevelCell): string {
  if (cell.won) {
    return `level ${cell.level} won in ${cell.attempts} attempt${cell.attempts === 1 ? "" : "s"}`;
  }
  if (cell.attempts === 0) {
    return `level ${cell.level} not attempted`;
  }
  return `level ${cell.level} not won, ${cell.attempts} attempts`;
}

function LevelCells({ cells }: { readonly cells: LeaderboardLevelCell[] }): React.JSX.Element {
  return (
    <>
      {cells.map((cell) => (
        <td
          key={cell.level}
          aria-label={cellLabel(cell)}
          /* The mark differs by more than colour: a won level carries a glyph
             and a solid background, so it survives a projector and a colourblind
             reader alike. */
          className={
            cell.won
              ? "px-2 py-2.5 text-center font-mono text-xs text-amber-200"
              : cell.attempts === 0
                ? "px-2 py-2.5 text-center font-mono text-xs text-stone-600"
                : "px-2 py-2.5 text-center font-mono text-xs text-stone-400"
          }
        >
          {cell.won ? "◆" : cell.attempts === 0 ? "·" : cell.attempts}
        </td>
      ))}
    </>
  );
}

function rankClasses(rank: number): string {
  if (rank === 1) {
    return "px-4 py-2.5 font-mono text-sm font-semibold text-amber-300";
  }
  if (rank <= 3) {
    return "px-4 py-2.5 font-mono text-sm text-amber-200/80";
  }
  return "px-4 py-2.5 font-mono text-sm text-stone-500";
}

function Row({ row }: { readonly row: LeaderboardRow }): React.JSX.Element {
  return (
    <tr className="border-t border-stone-800/80">
      <td className={rankClasses(row.rank)}>{row.rank}</td>
      <th scope="row" className="px-4 py-2.5 text-left text-sm font-normal text-stone-200">
        {row.email}
      </th>
      <td className="px-4 py-2.5 text-sm text-stone-300">
        {row.levelsCompleted}
        <span className="text-stone-600">/{LEADERBOARD_LEVELS.length}</span>
      </td>
      <LevelCells cells={row.levels} />
      <td className="px-4 py-2.5 text-right font-mono text-sm text-stone-400">
        {row.totalAttempts}
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-500">
        {row.lastWinAt === null ? "—" : new Date(row.lastWinAt).toLocaleTimeString()}
      </td>
    </tr>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}): Promise<React.JSX.Element> {
  await requireAdminPage();

  const params = await searchParams;
  const showAll = isShowAll(params);
  const board = await loadLeaderboard();

  const shown = showAll ? board.rows : board.rows.slice(0, DEFAULT_LIMIT);
  const hidden = board.rows.length - shown.length;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-100">
          Leaderboard
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
          {shown.length} of {board.rows.length} ranked
        </p>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-stone-400">
        Ranked by levels completed, then by fewest total attempts — a player who
        brute-forces has spent more to get there. Ties then go to whoever reached
        that record first, and finally to the email address, so the order is
        stable between refreshes. Attempts at levels already won, and in
        abandoned sessions, still count.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {board.summary.map((level) => (
          <div
            key={level.level}
            className="rounded-lg border border-stone-800 bg-stone-900/40 px-4 py-3"
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
              Level {level.level}
            </dt>
            <dd className="mt-1 text-sm text-stone-300">
              <span className="font-mono text-lg text-stone-100">{level.won}</span>
              <span className="text-stone-500"> won / {level.attempted} tried</span>
            </dd>
          </div>
        ))}
      </dl>

      {board.rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-stone-800 bg-stone-900/40 px-5 py-6 text-sm text-stone-400">
          Nobody has made an attempt yet.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <caption className="sr-only">
              Players ranked by levels completed, then fewest attempts.
            </caption>
            <thead className="bg-stone-900/60">
              <tr className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
                <th scope="col" className="px-4 py-3 font-normal">#</th>
                <th scope="col" className="px-4 py-3 font-normal">Player</th>
                <th scope="col" className="px-4 py-3 font-normal">Levels</th>
                {board.summary.map((level) => (
                  <th key={level.level} scope="col" className="px-2 py-3 text-center font-normal">
                    {level.level}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right font-normal">Attempts</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Last win</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <Row key={row.email} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500">
        <span>
          <span className="font-mono text-amber-200">◆</span> level won ·{" "}
          <span className="font-mono">·</span> not attempted · a number is attempts without a win
        </span>
        {hidden > 0 ? (
          <Link
            href="/admin/leaderboard?all=1"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400 underline-offset-4 hover:text-amber-300 hover:underline"
          >
            Show all {board.rows.length} ({hidden} more)
          </Link>
        ) : null}
        {board.playersExcluded > 0 ? (
          <span>
            {board.playersExcluded} of {board.playersTotal} accounts have not started and are not
            ranked.
          </span>
        ) : null}
      </p>
    </section>
  );
}
