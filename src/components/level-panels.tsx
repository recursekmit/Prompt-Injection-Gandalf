"use client";

import Link from "next/link";
import type * as React from "react";

import { LevelHeading, LevelTagline } from "@/components/level-heading";
import { WardenMark } from "@/components/warden-mark";
import { identityFor } from "@/lib/seal-identities";
import type { LevelNumber, LevelProgressDto } from "@/lib/types";

/**
 * Every non-chat state of a level: the gate before a level opens, the locked
 * screen, the card for a seal already broken, the celebration when one breaks
 * now, and the end of the run.
 *
 * They share a shell and each opens with the same `LevelHeading`, so the three
 * states read as one screen that changed rather than three unrelated pages. Copy
 * is short and concrete: the player is reading this in a loud room with one eye
 * on the room and one on the laptop.
 *
 * The panels are deliberately translucent over the level's backdrop, and dark
 * enough that the lightest level (sunlit sandstone) and the most saturated
 * (the violet void) both stay readable behind them.
 */

function Panel({
  children,
  tone = "plain",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "plain" | "amber" | "locked";
}): React.JSX.Element {
  const border =
    tone === "amber"
      ? "border-[rgba(158,254,0,0.4)] bg-[rgba(158,254,0,0.25)]"
      : tone === "locked"
        ? "border-[#1a1e23]/70 bg-[#050607]/80"
        : "border-[#1a1e23]/70 bg-[#050607]/70";
  return (
    <section
      className={`rounded-xl border ${border} px-6 py-8 backdrop-blur-sm sm:px-8 sm:py-10`}
    >
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
      className="mt-8 btn-recurse-primary text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9efe00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050607]"
    >
      {children}
    </button>
  );
}

function Eyebrow({
  children,
  tone = "muted",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "muted" | "amber";
}): React.JSX.Element {
  return (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.3em] ${
        tone === "amber" ? "text-[#9efe00]" : "text-[#5f6368]"
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
    <div className="flex flex-col gap-8">
      <LevelHeading level={level} />
      <Panel>
        <Eyebrow>seal {level} of three · not yet opened</Eyebrow>
        <div className="mt-5">
          <LevelTagline level={level} />
        </div>
        <p className="mt-5 max-w-xl text-sm leading-6 text-[#9aa0a6]">
          One guardian keeps one flag behind this seal. It will not hand the flag
          over — but a careful question can make it say more than it means to.
        </p>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#5f6368]">
          Nothing is lost by trying. Only by giving up.
        </p>

        {error !== null ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-[#22272e] border-l-2 border-l-[#9efe00] bg-[#0d0f12] px-4 py-3 text-sm leading-6 text-[#d0d7de]"
          >
            {error}
          </p>
        ) : null}

        <div>
          <PrimaryAction onClick={onStart} disabled={starting}>
            {starting ? "Opening the seal…" : `Start level ${level}`}
          </PrimaryAction>
        </div>

        <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-[#5f6368]">
          the seals open in order
        </p>
      </Panel>
    </div>
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
    <div className="flex flex-col gap-8">
      <LevelHeading level={level} />
      <Panel tone="locked">
        <div className="flex items-start gap-5">
          <span aria-hidden="true" className="mt-1 text-[#5f6368]">
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
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Seal {level} is locked
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#9aa0a6]">
              The seals open one at a time. The next seal that will answer is level{" "}
              {currentLevel}.
            </p>
            {notice !== null ? (
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#5f6368]">{notice}</p>
            ) : null}

            <div>
              <PrimaryAction onClick={onGoToCurrent}>Go to level {currentLevel}</PrimaryAction>
            </div>

            <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-[#5f6368]">
              sealed until level {level - 1} falls
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** A seal already broken, visited later: show the flag it gave up. */
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
    <div className="flex flex-col gap-8">
      <LevelHeading level={level} />
      <Panel>
        <Eyebrow tone="amber">seal broken</Eyebrow>
        <p className="mt-5 text-sm text-[#9aa0a6]">The flag it kept</p>
        <p className="mt-2 font-mono text-xl leading-snug font-semibold tracking-tight break-all text-[#adff00] sm:text-2xl">
          {word}
        </p>
        <div>
          <PrimaryAction onClick={onGoToCurrent}>Back to level {currentLevel}</PrimaryAction>
        </div>
      </Panel>
    </div>
  );
}

/**
 * The end of the run: three flags, in the order they were taken. This is the
 * payoff, so it is the one place all three flags are shown together.
 */
function RunSummary({
  levels,
}: {
  readonly levels: readonly LevelProgressDto[];
}): React.JSX.Element {
  const words = levels.filter((entry) => entry.revealedWord !== null);
  return (
    <div className="mt-8">
      <div className="flex flex-col gap-2">
        {words.map((entry) => (
          <span
            key={entry.level}
            className="inline-flex items-baseline gap-2 rounded-md border border-[rgba(158,254,0,0.3)] bg-[rgba(158,254,0,0.06)] px-3 py-1.5"
          >
            <span className="font-mono text-[10px] tracking-widest text-[#5f6368]">
              {String(entry.level).padStart(2, "0")}
            </span>
            <span className="font-mono text-sm break-all text-[#adff00]">{entry.revealedWord}</span>
          </span>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-[#9aa0a6]">
        Three seals, {words.length} flags. Every guardian in the archive has been talked
        past.
      </p>
      <p className="mt-2 text-sm leading-6 text-[#5f6368]">
        Your attempts per level are kept in{" "}
        <Link
          href="/dashboard"
          className="text-[#9efe00] underline-offset-4 hover:underline"
        >
          your ledger
        </Link>
        .
      </p>
    </div>
  );
}

/** The celebration: a seal just broke, so present the flag and the next step. */
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
  const isFinal = level === 3 || everyLevelBeaten;
  const identity = identityFor(level);

  return (
    <section
      role="status"
      aria-label={`Level ${level}, ${identity.name}, complete. The flag was ${word}.`}
      className="rounded-xl border border-[rgba(158,254,0,0.5)] bg-gradient-to-b from-[rgba(158,254,0,0.16)] to-[#050607]/70 px-6 py-8 backdrop-blur-sm sm:px-8 sm:py-10 motion-safe:animate-[reveal_500ms_ease-out]"
    >
      <div className="flex items-start gap-5">
        <span aria-hidden="true" className="mt-1 text-[#9efe00]">
          <WardenMark className="h-9 w-9 motion-safe:animate-[crack_700ms_ease-out]" />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow tone="amber">
            {isFinal ? "the last seal breaks" : "the seal breaks"}
          </Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {isFinal ? "Every seal is broken" : `${identity.name} yields`}
          </h2>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.4em] text-[#9aa0a6]">
            {identity.title}
          </p>

          <p className="mt-6 text-sm text-[#9aa0a6]">The flag it kept</p>
          <p className="mt-2 font-mono text-2xl leading-snug font-semibold tracking-tight break-all text-[#adff00] sm:text-3xl">
            {word}
          </p>
          {revealAttempts === null ? null : (
            <p className="mt-4 text-sm leading-6 text-[#9aa0a6]">
              Taken in {revealAttempts} {revealAttempts === 1 ? "attempt" : "attempts"}.
            </p>
          )}

          {error !== null ? (
            <p
              role="alert"
              className="mt-6 rounded-md border border-[#22272e] border-l-2 border-l-[#9efe00] bg-[#0d0f12] px-4 py-3 text-sm leading-6 text-[#d0d7de]"
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
              <p className="mt-4 text-xs text-[#5f6368]">
                The transcript below stays until you leave it.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
