"use client";

import type * as React from "react";

import { identityFor } from "@/lib/seal-identities";
import type { LevelNumber, LevelProgressDto } from "@/lib/types";

/**
 * The six seals: the game's spine and the one place the design spends its
 * boldness. Six levels beaten in order is a real sequence, so the steps are
 * numbered — the number encodes position in the chain, not decoration.
 *
 * Three states, and they must be distinguishable without colour, because a
 * colourblind player in a noisy room is the normal case, not the edge case:
 *
 *   COMPLETED — a filled seal with a tick, labelled with the word it gave up.
 *               The word is shown because the seal is broken; showing it
 *               earlier would be the whole game.
 *   CURRENT   — a live amber seal with a ring, labelled with the level's own
 *               seal-band label ("open now", "reflection", "maze"…). It pulses
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

const LEVEL_ORDER: readonly LevelNumber[] = [1, 2, 3, 4, 5, 6];

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
      className="block h-3 w-3 rounded-full border-2 border-amber-400 bg-amber-400/10"
    />
  );
}

/** The live seal's heartbeat: only rendered when motion is allowed. */
function Pulse(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden rounded-lg ring-2 ring-amber-400/40 motion-safe:block motion-safe:animate-ping"
    />
  );
}

const STEP_BASE =
  "relative z-10 flex h-full min-h-[4.75rem] w-full flex-col justify-between gap-3 rounded-lg border px-2.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950";

function stepClasses(status: LevelProgressDto["status"], selected: boolean): string {
  const ring = selected ? "ring-2 ring-offset-2 ring-offset-stone-950 " : "";
  switch (status) {
    case "COMPLETED":
      return `${ring}border-amber-500/40 bg-amber-500/[0.07] ${
        selected ? "ring-amber-300/60" : ""
      } hover:border-amber-400/70`;
    case "CURRENT":
      return `${ring}border-amber-500/80 bg-stone-900 ${
        selected ? "ring-amber-400/70" : ""
      } hover:border-amber-400`;
    case "LOCKED":
      return `${ring}border-stone-800 bg-stone-900 ${
        selected ? "ring-stone-600" : ""
      } hover:border-stone-700`;
  }
}

/** The one word under a seal: its revealed word, its label, or "locked". */
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
      return `Level ${progress.level}, seal broken. Word: ${progress.revealedWord ?? "unknown"}.`;
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
  // The API always returns six, ascending, but the band is defensive about it:
  // it renders what it was given rather than assuming a length, so a shorter
  // response cannot silently draw six empty seals.
  const ordered = LEVEL_ORDER.map((level) =>
    levels.find((entry) => entry.level === level),
  ).filter((entry): entry is LevelProgressDto => entry !== undefined);

  const broken = ordered.filter((entry) => entry.status === "COMPLETED").length;

  return (
    <nav
      aria-label="Your progression through the six seals"
      className="border-b border-stone-800 bg-stone-950/80"
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-stone-500">
            the six seals
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
            {everyLevelBeaten ? (
              <span className="text-amber-300">All six seals broken</span>
            ) : (
              <>
                {broken} of {ordered.length} seals broken
              </>
            )}
          </p>
        </div>

        <div className="relative overflow-x-auto pb-1">
          {/* The chain the seals hang on. It sits behind the steps, which are
              opaque, so it reads as a line threading them together. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-px min-w-[38rem] bg-gradient-to-r from-transparent via-stone-700 to-transparent"
          />
          <ol className="relative flex min-w-[38rem] gap-2">
            {ordered.map((entry) => {
              const isSelected = entry.level === selected;
              const isCurrent = entry.status === "CURRENT";
              return (
                <li key={entry.level} className="flex-1">
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
                          entry.status === "LOCKED" ? "text-stone-500" : "text-stone-400"
                        }`}
                      >
                        {pad(entry.level)}
                      </span>
                      <span
                        className={
                          entry.status === "COMPLETED"
                            ? "text-amber-300"
                            : entry.status === "CURRENT"
                              ? "text-amber-400"
                              : "text-stone-500"
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
                            ? "truncate font-display text-base leading-5 text-amber-200"
                            : entry.status === "CURRENT"
                              ? "truncate font-mono text-[11px] uppercase tracking-[0.15em] text-stone-100"
                              : "font-mono text-[11px] uppercase tracking-[0.15em] text-stone-500"
                        }
                        title={entry.status === "COMPLETED" ? entry.revealedWord ?? "" : undefined}
                      >
                        {sealLabel(entry)}
                      </span>
                      <span className="text-[10px] leading-4 text-stone-500">
                        {footnote(entry)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </nav>
  );
}
