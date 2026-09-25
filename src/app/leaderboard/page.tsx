import Link from "next/link";
import type * as React from "react";

import { SiteHeader } from "@/components/site-header";
import { loadPublicLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

// RANK + PARTICIPANT + six level columns + SEALS.
const COLUMN_COUNT = 9;

export default async function LeaderboardPage(): Promise<React.JSX.Element> {
  const board = await loadPublicLeaderboard();
  const { rows, playersExcluded, playersTotal } = board;

  return (
    <div className="flex flex-1 flex-col bg-[#050607] text-[#d0d7de]">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-12 md:px-8">
        <header>
          <p className="terminal-tag">LIVE_RANKINGS // THE SEALED ARCHIVE</p>
          <h1 className="mt-3 font-mono text-[2.5rem] font-black uppercase leading-none tracking-tight text-white">
            SEAL BREAKERS
          </h1>
          <p className="mt-3 font-mono text-sm text-[#9aa0a6]">
            {playersTotal} archivists · {rows.length} have drawn a seal
          </p>
        </header>

        <section className="recurse-card mt-8 overflow-hidden shadow-[0_0_25px_rgba(158,254,0,0.15)]">
          <div className="flex items-center justify-between bg-[#06080a] px-5 py-3">
            <span className="font-mono text-xs uppercase tracking-widest text-[#9aa0a6]">
              ACTIVE BREAKERS [{rows.length}]
            </span>
            <span className="font-mono text-xs uppercase tracking-widest text-[#9efe00]">
              <span className="status-beacon" /> LIVE
            </span>
          </div>

          <div className="overflow-x-auto">
            <table
              aria-label="PromptGuard public leaderboard: seal breakers ranked by seals drawn"
              className="w-full min-w-[48rem] border-collapse text-left font-mono text-sm"
            >
              <thead>
                <tr className="bg-[#06080a] text-[0.7rem] uppercase tracking-widest text-[#9aa0a6]">
                  <th scope="col" className="px-5 py-3 font-normal">RANK</th>
                  <th scope="col" className="px-5 py-3 font-normal">PARTICIPANT</th>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <th key={level} scope="col" className="px-3 py-3 text-center font-normal">
                      L{level}
                    </th>
                  ))}
                  <th scope="col" className="px-5 py-3 font-normal">SEALS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={COLUMN_COUNT}
                      className="px-5 py-10 text-center text-[#9aa0a6]"
                    >
                      No seals drawn yet. Be the first.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const displayName = row.name ?? row.rollNumber ?? "Unknown breaker";
                    const showRollLine =
                      row.rollNumber !== null && row.name !== null;
                    return (
                      <tr
                        key={`${row.rank}-${row.rollNumber ?? row.name ?? "unknown"}`}
                        className="border-t border-[#1a1e23]"
                      >
                        <td
                          className={
                            row.rank === 1
                              ? "px-5 py-3 font-bold text-[#9efe00]"
                              : "px-5 py-3 text-[#d0d7de]"
                          }
                        >
                          #{String(row.rank).padStart(2, "0")}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-white">{displayName}</span>
                          {showRollLine ? (
                            <span className="block text-xs text-[#5f6368]">
                              {row.rollNumber}
                            </span>
                          ) : null}
                        </td>
                        {row.levels.map((cell) => (
                          <td key={cell.level} className="px-3 py-3 text-center">
                            {cell.won ? (
                              <span className="font-bold text-[#9efe00]">✓</span>
                            ) : (
                              <span className="text-[#5f6368]">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-5 py-3">
                          <span className="rounded-sm bg-[rgba(158,254,0,0.12)] px-2 py-0.5 font-mono text-xs text-[#9efe00]">
                            {row.levelsCompleted}/6
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {playersExcluded > 0 ? (
          <p className="mt-4 font-mono text-xs text-[#9aa0a6]">
            {playersExcluded} archivist(s) not shown — no attempts yet.
          </p>
        ) : null}

        <div className="mt-8">
          <Link href="/challenges" className="btn-recurse-secondary">
            ENTER THE ARCHIVE →
          </Link>
        </div>
      </main>
    </div>
  );
}
