"use client";

import type * as React from "react";

import { identityFor } from "@/lib/seal-identities";
import type { LevelNumber, LevelProgressDto } from "@/lib/types";

/**
 * The three seals: the game's spine and the one place the design spends its
 * boldness. Three levels beaten in order is a real sequence, so the steps are
 * numbered — the number encodes position in the chain, not decoration.
 *
 * Three states, and they must be distinguishable without colour, because a
 * colourblind player in a noisy room is the normal case, not the edge case:
 *
 *   COMPLETED — a filled seal with a tick, labelled with the flag it gave up.
 *               The flag is shown because the seal is broken; showing it
 *               earlier would be the whole game.
 *   CURRENT   — a live amber seal with a ring, labelled with the level's own
 *               seal-band label ("open now", "revelation"…). It pulses
 *               only when motion is welcome.
 *   LOCKED    — a hatched, chained seal carrying a padlock and the word
 *               "locked". It reads as shut, never as merely dimmed, so nobody
 *               wonders whether it is clickable. It is a button anyway:
 *               pressing it lands on the locked screen rather than doing
 *               nothing.
 *
 * Every state carries an aria-label naming the level and the state, so the
 * band is never a colour chart.
 */

const LEVEL_ORDER: readonly LevelNumber[] = [1, 2, 3];

function pad(level: number): string {
  return String(level).padStart(2, "0");
}

function Tick(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M3 8.5 6.2 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Lock(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <rect
        x="3.5"
        y="7"
        width="9"
        height="6.5"
        rx="1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.75 7V5.5a2.25 2.25 0 0 1 4.5 0V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The open seal's ring: a live marker that is not a dot, so it reads as a seal. */
function Ring(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="block h-3 w-3 rounded-full border-2 border-[#9efe00] bg-[rgba(158,254,0,0.12)]"
    />
  );
}

/** The live seal's heartbeat: only rendered when motion is allowed. */
function Pulse(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden rounded-sm ring-2 ring-[rgba(158,254,0,0.4)] motion-safe:block motion-safe:animate-ping"
    />
  );
}

const STEP_BASE =
  "relative z-10 flex h-full min-h-[4.75rem] w-full flex-col justify-between gap-3 rounded-sm border px-2.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9efe00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050607]";

function stepClasses(status: LevelProgressDto["status"], selected: boolean): string {
  const ring = selected ? "ring-2 ring-offset-2 ring-offset-[#050607] " : "";
  switch (status) {
    case "COMPLETED":
      return `${ring}border-[rgba(158,254,0,0.4)] bg-[rgba(158,254,0,0.07)] ${
        selected ? "ring-[rgba(158,254,0,0.6)]" : ""
      } hover:border-[rgba(158,254,0,0.7)]`;
    case "CURRENT":
      return `${ring}border-[rgba(158,254,0,0.8)] bg-[#0d0f12] ${
        selected ? "ring-[rgba(158,254,0,0.7)]" : ""
      } hover:border-[#9efe00]`;
    case "LOCKED":
      return `${ring}border-[#1a1e23] bg-[#0d0f12] ${
        selected ? "ring-[#5f6368]" : ""
      } hover:border-[#22272e]`;
  }
}

/** The one label under a seal: its revealed flag, its label, or "locked". */
function sealLabel(progress: LevelProgressDto): string {
  switch (progress.status) {
    case "COMPLETED":
      return progress.revealedWord ?? "broken";
    case "CURRENT":
      return identityFor(progress.level).sealLabel;
    case "LOCKED":
      return "locked";
  }
}

function footnote(progress: LevelProgressDto): string {
  switch (progress.status) {
    case "COMPLETED":
      return "seal broken";
    case "CURRENT":
      return "the open seal";
    case "LOCKED":
      return `after level ${progress.level - 1}`;
  }
}

function ariaLabel(progress: LevelProgressDto): string {
  switch (progress.status) {
    case "COMPLETED":
      return `Level ${progress.level}, seal broken. Flag: ${progress.revealedWord ?? "unknown"}.`;
    case "CURRENT":
      return `Level ${progress.level}, the open seal: ${identityFor(progress.level).sealLabel}.`;
    case "LOCKED":
      return `Level ${progress.level}, locked. Break the seal of level ${
        progress.level - 1
      } first.`;
  }
}

interface SealBandProps {
  readonly levels: readonly LevelProgressDto[];
  readonly selected: LevelNumber;
  readonly everyLevelBeaten: boolean;
  readonly onSelect: (level: LevelNumber) => void;
}

export function SealBand({
  levels,
  selected,
  everyLevelBeaten,
  onSelect,
}: SealBandProps): React.JSX.Element {
  // The API always returns three, ascending, but the band is defensive about it:
  // it renders what it was given rather than assuming a length, so a shorter
  // response cannot silently draw three empty seals.
  const ordered = LEVEL_ORDER.map((level) =>
    levels.find((entry) => entry.level === level),
  ).filter((entry): entry is LevelProgressDto => entry !== undefined);

  const broken = ordered.filter((entry) => entry.status === "COMPLETED").length;

  return (
    <nav
      aria-label="Your progression through the three seals"
      className="border-b border-[#1a1e23] bg-[#050607]/80 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      <div className="px-6 py-4 lg:sticky lg:top-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#5f6368]">
            the three seals
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5f6368]">
            {everyLevelBeaten ? (
              <span className="text-[#9efe00]">All three seals broken</span>
            ) : (
              <>
                {broken} of {ordered.length} seals broken
              </>
            )}
          </p>
        </div>

        <ol className="flex flex-col gap-2">
          {ordered.map((entry) => {
            const isSelected = entry.level === selected;
            const isCurrent = entry.status === "CURRENT";
            return (
              <li key={entry.level}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.level)}
                  aria-label={ariaLabel(entry)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`${STEP_BASE} ${stepClasses(entry.status, isSelected)}`}
                >
                  {isCurrent ? <Pulse /> : null}

                  {/* Hatched fill: the locked seal is barred, not faded. */}
                  {entry.status === "LOCKED" ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-lg bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(120,113,108,0.22)_5px,rgba(120,113,108,0.22)_10px)]"
                    />
                  ) : null}

                  <span className="relative flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-[10px] tracking-[0.25em] ${
                        entry.status === "LOCKED" ? "text-[#5f6368]" : "text-[#9aa0a6]"
                      }`}
                    >
                      {pad(entry.level)}
                    </span>
                    <span
                      className={
                        entry.status === "COMPLETED"
                          ? "text-[#9efe00]"
                          : entry.status === "CURRENT"
                            ? "text-[#9efe00]"
                            : "text-[#5f6368]"
                      }
                    >
                      {entry.status === "COMPLETED" ? (
                        <Tick />
                      ) : entry.status === "CURRENT" ? (
                        <Ring />
                      ) : (
                        <Lock />
                      )}
                    </span>
                  </span>

                  <span className="relative flex flex-col gap-0.5">
                    <span
                      className={
                        entry.status === "COMPLETED"
                          ? "truncate font-mono text-xs leading-5 text-[#adff00]"
                          : entry.status === "CURRENT"
                            ? "truncate font-mono text-[11px] uppercase tracking-[0.15em] text-white"
                            : "font-mono text-[11px] uppercase tracking-[0.15em] text-[#5f6368]"
                      }
                      title={entry.status === "COMPLETED" ? entry.revealedWord ?? "" : undefined}
                    >
                      {sealLabel(entry)}
                    </span>
                    <span className="text-[10px] leading-4 text-[#5f6368]">
                      {footnote(entry)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
