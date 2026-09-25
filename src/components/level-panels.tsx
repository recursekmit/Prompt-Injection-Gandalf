"use client";

import Link from "next/link";
import type * as React from "react";

import { WardenMark } from "@/components/warden-mark";
import type { LevelNumber, LevelProgressDto } from "@/lib/types";

/**
 * Every non-chat state of a level: the gate before a level opens, the locked
 * screen, the card for a seal already broken, the celebration when one breaks
 * now, and the end of the run.
 *
 * They share a shell so the six states read as one screen that changed rather
 * than six unrelated pages. Copy is short and concrete: the player is reading
 * this in a loud room with one eye on the room and one on the laptop.
 */

const ORDINAL: Record<LevelNumber, string> = {
  1: "First",
  2: "Second",
  3: "Third",
  4: "Fourth",
  5: "Fifth",
  6: "Sixth",
};

function ordinal(level: LevelNumber): string {
  return ORDINAL[level];
}

function Panel({
  children,
  tone = "plain",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "plain" | "amber" | "locked";
}): React.JSX.Element {
  const border =
    tone === "amber"
      ? "border-amber-500/40 bg-amber-500/[0.06]"
      : tone === "locked"
        ? "border-stone-800 bg-stone-900/50"
        : "border-stone-800 bg-stone-900/40";
  return (
    <section className={`rounded-xl border ${border} px-6 py-8 sm:px-8 sm:py-10`}>
      {children}
    </section>
  );
}

function PrimaryAction({
  onClick,
  disabled,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled ?? false}
      className="mt-8 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
    >
      {children}
    </button>
  );
}

function Eyebrow({ children, tone = "muted" }: { readonly children: React.ReactNode; readonly tone?: "muted" | "amber" }): React.JSX.Element {
  return (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.3em] ${
        tone === "amber" ? "text-amber-400" : "text-stone-500"
      }`}
    >
      {children}
    </p>
  );
}

/** The gate: the current level is open, but no session has been started. */
export function LevelGate({
  level,
  starting,
  error,
  onStart,
}: {
  readonly level: LevelNumber;
  readonly starting: boolean;
  readonly error: string | null;
  readonly onStart: () => void;
}): React.JSX.Element {
  return (
    <Panel>
      <Eyebrow>seal {level} of six · open now</Eyebrow>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
        The {ordinal(level)} Seal
      </h2>
      <p className="mt-4 max-w-xl text-sm leading-6 text-stone-400">
        One warden keeps one word behind this seal. It will not hand the word over
        — but a careful question can make it say more than it means to.
      </p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">
        Nothing is lost by trying. Only by giving up.
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-6 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <div>
        <PrimaryAction onClick={onStart} disabled={starting}>
          {starting ? "Opening the seal…" : `Start level ${level}`}
        </PrimaryAction>
      </div>

      <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-stone-600">
        the wardens open in order
      </p>
    </Panel>
  );
}

/** The locked screen: this level is not the one that is open. */
export function LockedSeal({
  level,
  currentLevel,
  notice,
  onGoToCurrent,
}: {
  readonly level: LevelNumber;
  readonly currentLevel: LevelNumber;
  readonly notice: string | null;
  readonly onGoToCurrent: () => void;
}): React.JSX.Element {
  return (
    <Panel tone="locked">
      <div className="flex items-start gap-5">
        <span aria-hidden="true" className="mt-1 text-stone-500">
          <svg viewBox="0 0 16 16" className="h-8 w-8">
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
        </span>
        <div className="min-w-0">
          <Eyebrow>chained</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-100 sm:text-3xl">
            Seal {level} is locked
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-stone-400">
            The wardens open one at a time. The next seal that will answer is level{" "}
            {currentLevel}.
          </p>
          {notice !== null ? (
            <p className="mt-3 max-w-xl text-sm leading-6 text-stone-500">{notice}</p>
          ) : null}

          <div>
            <PrimaryAction onClick={onGoToCurrent}>Go to level {currentLevel}</PrimaryAction>
          </div>

          <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-stone-600">
            sealed until level {level - 1} falls
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** A seal already broken, visited later: show the word it gave up. */
export function SealBroken({
  level,
  word,
  currentLevel,
  onGoToCurrent,
}: {
  readonly level: LevelNumber;
  readonly word: string;
  readonly currentLevel: LevelNumber;
  readonly onGoToCurrent: () => void;
}): React.JSX.Element {
  return (
    <Panel>
      <Eyebrow tone="amber">seal broken</Eyebrow>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-stone-100 sm:text-3xl">
        The {ordinal(level)} Seal
      </h2>
      <p className="mt-5 text-sm text-stone-400">The word it kept</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-wide text-amber-300 sm:text-4xl">
        {word}
      </p>
      <div>
        <PrimaryAction onClick={onGoToCurrent}>Back to level {currentLevel}</PrimaryAction>
      </div>
    </Panel>
  );
}

/**
 * The end of the run: six words, in the order they were taken. This is the
 * payoff, so it is the one place all six words are shown together.
 */
function RunSummary({ levels }: { readonly levels: readonly LevelProgressDto[] }): React.JSX.Element {
  const words = levels.filter((entry) => entry.revealedWord !== null);
  return (
    <div className="mt-8">
      <div className="flex flex-wrap gap-2">
        {words.map((entry) => (
          <span
            key={entry.level}
            className="inline-flex items-baseline gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5"
          >
            <span className="font-mono text-[10px] tracking-widest text-stone-500">
              {String(entry.level).padStart(2, "0")}
            </span>
            <span className="font-mono text-sm text-amber-200">{entry.revealedWord}</span>
          </span>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-stone-400">
        Six seals, {words.length} words. Every guardian in the archive has been talked
        past.
      </p>
      <p className="mt-2 text-sm leading-6 text-stone-500">
        Your attempts per level are kept in{" "}
        <Link
          href="/dashboard"
          className="text-amber-300 underline-offset-4 hover:underline"
        >
          your ledger
        </Link>
        .
      </p>
    </div>
  );
}

/** The celebration: a seal just broke, so present the word and the next step. */
export function SealReveal({
  level,
  word,
  revealAttempts,
  everyLevelBeaten,
  levels,
  starting,
  error,
  onStartNext,
}: {
  readonly level: LevelNumber;
  readonly word: string;
  /** Null when the reveal is rebuilt from a reload and the count is not to hand. */
  readonly revealAttempts: number | null;
  readonly everyLevelBeaten: boolean;
  readonly levels: readonly LevelProgressDto[];
  readonly starting: boolean;
  readonly error: string | null;
  readonly onStartNext: () => void;
}): React.JSX.Element {
  const isFinal = level === 6 || everyLevelBeaten;

  return (
    <section
      role="status"
      aria-label={`Level ${level} complete. The word was ${word}.`}
      className="rounded-xl border border-amber-500/50 bg-gradient-to-b from-amber-500/[0.12] to-amber-500/[0.02] px-6 py-8 sm:px-8 sm:py-10 motion-safe:animate-[reveal_500ms_ease-out]"
    >
      <div className="flex items-start gap-5">
        <span aria-hidden="true" className="mt-1 text-amber-400">
          <WardenMark className="h-9 w-9 motion-safe:animate-[crack_700ms_ease-out]" />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow tone="amber">
            {isFinal ? "the last seal breaks" : "the seal breaks"}
          </Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
            {isFinal ? "Every seal is broken" : `Level ${level} yields`}
          </h2>

          <p className="mt-6 text-sm text-stone-400">The word it kept</p>
          <p className="mt-2 font-mono text-4xl font-semibold tracking-wide text-amber-300 sm:text-5xl">
            {word}
          </p>
          {revealAttempts === null ? null : (
            <p className="mt-4 text-sm leading-6 text-stone-400">
              Taken in {revealAttempts} {revealAttempts === 1 ? "attempt" : "attempts"}.
            </p>
          )}

          {error !== null ? (
            <p
              role="alert"
              className="mt-6 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-6 text-red-200"
            >
              {error}
            </p>
          ) : null}

          {isFinal ? (
            <RunSummary levels={levels} />
          ) : (
            <>
              <div>
                <PrimaryAction onClick={onStartNext} disabled={starting}>
                  {starting ? "Opening the seal…" : `Start level ${level + 1}`}
                </PrimaryAction>
              </div>
              <p className="mt-4 text-xs text-stone-500">
                The transcript below stays until you leave it.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
