"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { LevelHeading, LevelTagline, PaperPlane } from "@/components/level-heading";
import { WardenMark } from "@/components/warden-mark";
import { formatTimestamp, planSubmit } from "@/lib/composer";
import { identityFor } from "@/lib/seal-identities";
import type { AttemptDto, SessionDto } from "@/lib/types";

/**
 * The conversation with the current guardian: the level's identity, the
 * transcript, the thinking state while a reply is in flight, and the composer.
 *
 * The transcript is rebuilt from `session.attempts`, so a reload restores it
 * exactly — there is no client-side message store to drift from the server.
 */

/** Matches the server's sanitiser cap, so the browser never promises more room than the model will see. */
const MAX_MESSAGE_LENGTH = 2000;
/** Where the character counter starts warning, leaving room to react before the cap. */
const COUNTER_VISIBLE_FROM = 1600;

const DUPLICATE_NOTICE =
  "You have already tried that one — try a different angle.";

/**
 * How long the guardian has been thinking, in words. A guardian call can take
 * 10-25 seconds under load, so a bare spinner reads as "stuck"; naming what is
 * happening keeps the wait believable.
 */
function thinkingHint(elapsedMs: number): string {
  if (elapsedMs < 7_000) {
    return "the warden is listening…";
  }
  if (elapsedMs < 18_000) {
    return "the warden is deliberating…";
  }
  return "the warden is still deliberating — a full house makes it slow.";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function ThinkingDots(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="inline-flex items-end gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="block h-1.5 w-1.5 rounded-full bg-[#5f6368] motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function Avatar(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#22272e] bg-[#050607]/80 text-[rgba(158,254,0,0.9)] backdrop-blur-sm"
    >
      <WardenMark className="h-4 w-4" />
    </span>
  );
}

function Bubble({
  speaker,
  meta,
  timestamp,
  leaked,
  children,
}: {
  readonly speaker: "player" | "warden";
  readonly meta: string;
  readonly timestamp: { readonly iso: string; readonly label: string };
  readonly leaked: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const isPlayer = speaker === "player";
  return (
    <div className={`flex gap-3 ${isPlayer ? "justify-end" : "justify-start"}`}>
      {isPlayer ? null : <Avatar />}
      <div
        className={[
          "max-w-[85%] px-4 py-3 backdrop-blur-sm sm:max-w-[75%]",
          isPlayer
            ? "rounded-xl rounded-br-sm border border-[rgba(158,254,0,0.35)] bg-[rgba(158,254,0,0.08)]"
            : leaked
              ? "rounded-xl rounded-bl-sm border border-[rgba(158,254,0,0.5)] bg-[#050607]/80"
              : "rounded-xl rounded-bl-sm border border-[#1a1e23] bg-[#0d0f12]",
        ].join(" ")}
      >
        <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] uppercase tracking-widest text-[#5f6368]">
          <span className={isPlayer ? "text-[#9aa0a6]" : "text-[rgba(158,254,0,0.8)]"}>
            {isPlayer ? "you" : "Warden"}
          </span>
          <span>{meta}</span>
          <time dateTime={timestamp.iso} className="text-[#5f6368] normal-case tracking-normal">
            {timestamp.label}
          </time>
        </p>
        <p
          className={`whitespace-pre-wrap text-sm leading-6 ${
            isPlayer ? "text-[#d0d7de]" : leaked ? "text-[#adff00]" : "text-[#d0d7de]"
          }`}
        >
          {children}
        </p>
      </div>
    </div>
  );
}

/**
 * The attempts, oldest first, as a list of exchanges. Exported on its own so
 * the celebration can show the winning transcript without the composer.
 */
export function Transcript({
  attempts,
}: {
  readonly attempts: readonly AttemptDto[];
}): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-6" aria-label="Attempt history">
      {attempts.map((attempt: AttemptDto, index: number) => (
        <li key={attempt.id} className="flex flex-col gap-4">
          <Bubble
            speaker="player"
            meta={`attempt ${index + 1}`}
            timestamp={{
              iso: attempt.createdAt,
              label: formatTimestamp(attempt.createdAt),
            }}
            leaked={false}
          >
            {attempt.userMessage}
          </Bubble>
          <Bubble
            speaker="warden"
            meta={attempt.leaked ? "leak" : `reply to ${index + 1}`}
            timestamp={{
              iso: attempt.createdAt,
              label: formatTimestamp(attempt.createdAt),
            }}
            leaked={attempt.leaked}
          >
            {attempt.aiResponse}
          </Bubble>
        </li>
      ))}
    </ol>
  );
}

interface LevelChatProps {
  readonly session: SessionDto;
  readonly error: string | null;
  readonly surrenderBusy: boolean;
  readonly onSend: (message: string) => Promise<boolean>;
  readonly onSurrender: () => void;
  readonly onContinue: () => void;
}

export function LevelChat({
  session,
  error,
  surrenderBusy,
  onSend,
  onSurrender,
  onContinue,
}: LevelChatProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);

  const nearBottomRef = useRef(true);

  const openForPlay = session.status === "IN_PROGRESS";
  const attemptTotal = session.attempts.length;

  // Whether the player is reading history or watching the newest line. Tracked
  // on the window because the conversation is in the page flow, not a fixed pane.
  useEffect(() => {
    function onScroll(): void {
      const doc = document.documentElement;
      nearBottomRef.current =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 180;
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Follow the newest message, but never yank the view while the player is up
  // the page reading an earlier exchange.
  //
  // Scrolling the window to its end, rather than a sentinel inside the
  // transcript, is deliberate: the composer is sticky at the bottom of the page,
  // so scrolling a sentinel to the viewport edge would leave the input just
  // off-screen exactly when the player is about to type in it.
  useEffect(() => {
    if (!nearBottomRef.current) {
      return;
    }
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [attemptTotal, sending]);

  // Time the wait so the hint can escalate. Reset whenever a request starts.
  useEffect(() => {
    if (!sending) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => window.clearInterval(id);
  }, [sending]);

  const submit = useCallback(async (): Promise<void> => {
    const plan = planSubmit({
      draft,
      history: session.attempts.map((attempt) => attempt.userMessage),
      openForPlay,
      sending,
    });

    if (plan.kind === "ignore") {
      return;
    }

    // Local, instant refusal. The client is the attacker's to modify, so the
    // server's 409 is the real rule; this only saves a round trip. See
    // `planSubmit`, which carries the same note next to the check itself.
    if (plan.kind === "refuse") {
      setDuplicateNotice(DUPLICATE_NOTICE);
      return;
    }

    setDuplicateNotice(null);
    setSending(true);
    const ok = await onSend(plan.message);
    setSending(false);
    if (ok) {
      setDraft("");
    }
  }, [draft, openForPlay, onSend, sending, session.attempts]);

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const remaining = MAX_MESSAGE_LENGTH - draft.length;

  return (
    <div className="flex flex-1 flex-col">
      <LevelHeading level={session.level} />

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-[#1a1e23] py-3 text-sm">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9aa0a6]">
          <span className="text-white">{session.attemptCount}</span>{" "}
          {session.attemptCount === 1 ? "attempt" : "attempts"}
        </span>
        {session.flagged ? (
          <span className="text-xs text-[rgba(158,254,0,0.8)]">
            pace flagged — slow down or the warden stops answering
          </span>
        ) : null}
        {openForPlay ? (
          <button
            type="button"
            onClick={onSurrender}
            disabled={surrenderBusy || sending}
            className="ml-auto rounded-md border border-[#22272e] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#9aa0a6] transition-colors hover:border-red-800 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Surrender
          </button>
        ) : null}
      </div>

      <div className="flex-1 py-8">
        {attemptTotal === 0 ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#5f6368]">
            no attempts yet — the seal is intact
          </p>
        ) : (
          <Transcript attempts={session.attempts} />
        )}

        {sending && openForPlay ? (
          <div className="mt-6 flex gap-3" aria-live="polite" aria-busy="true">
            <Avatar />
            <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-[#1a1e23] bg-[#0d0f12] px-4 py-3 backdrop-blur-sm sm:max-w-[75%]">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-[rgba(158,254,0,0.8)]">
                Warden
              </p>
              <p className="flex items-center gap-3 text-sm leading-6 text-[#d0d7de]">
                <ThinkingDots />
                <span>{thinkingHint(elapsedMs)}</span>
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-900/60 bg-red-950/60 px-4 py-3 text-sm leading-6 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-6 border-t border-[#1a1e23] bg-[#050607]/85 px-6 pb-6 pt-4 backdrop-blur">
        {openForPlay ? (
          <>
            <LevelTagline level={session.level} />

            {duplicateNotice !== null ? (
              <p
                role="status"
                className="mt-3 rounded-md border border-[rgba(158,254,0,0.4)] bg-[rgba(158,254,0,0.09)] px-4 py-2.5 text-sm text-[#adff00]"
              >
                {duplicateNotice}
              </p>
            ) : null}

            <label htmlFor="attempt" className="sr-only">
              Your message to the warden
            </label>
            <div className="relative mt-4">
              <textarea
                id="attempt"
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (duplicateNotice !== null) {
                    setDuplicateNotice(null);
                  }
                }}
                onKeyDown={onKeyDown}
                disabled={sending}
                rows={3}
                placeholder={identityFor(session.level).placeholder}
                aria-describedby="composer-help"
                className="w-full resize-y rounded-xl border border-[#1a1e23] bg-[#050607]/80 py-4 pl-4 pr-28 font-sans text-sm leading-7 text-white placeholder:text-[#5f6368] focus:border-[rgba(158,254,0,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(158,254,0,0.4)] disabled:cursor-not-allowed disabled:opacity-50 sm:pr-36"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending || draft.trim() === ""}
                aria-busy={sending}
                className="btn-recurse-primary absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed"
              >
                <PaperPlane className="h-4 w-4" />
                {sending ? "waiting…" : "Send"}
              </button>
            </div>
            <p id="composer-help" className="mt-3 text-xs text-[#5f6368]">
              Enter sends · Shift+Enter for a new line
              {draft.length >= COUNTER_VISIBLE_FROM ? (
                <span className={remaining <= 100 ? " text-[#9efe00]" : ""}>
                  {" "}
                  · {remaining} characters left
                </span>
              ) : null}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-[#9aa0a6]">
              {session.status === "WON"
                ? "The seal is broken. The transcript stays."
                : "This session is closed. The level is still unbeaten."}
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-md border border-[#22272e] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#d0d7de] transition-colors hover:border-[rgba(158,254,0,0.7)] hover:text-[#adff00] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9efe00]"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
