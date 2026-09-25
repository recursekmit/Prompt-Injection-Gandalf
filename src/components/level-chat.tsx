"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { WardenMark } from "@/components/warden-mark";
import { formatTimestamp, planSubmit } from "@/lib/composer";
import type { AttemptDto, SessionDto } from "@/lib/types";

/**
 * The conversation with the current warden: the transcript, the thinking state
 * while a reply is in flight, and the composer.
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
          className="block h-1.5 w-1.5 rounded-full bg-stone-500 motion-safe:animate-bounce"
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
      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-amber-400/90"
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
          "max-w-[85%] px-4 py-3 sm:max-w-[75%]",
          isPlayer
            ? "rounded-xl rounded-br-sm border border-stone-700 bg-stone-800/70"
            : leaked
              ? "rounded-xl rounded-bl-sm border border-amber-500/50 bg-amber-500/[0.07]"
              : "rounded-xl rounded-bl-sm border border-stone-800 bg-stone-900/60",
        ].join(" ")}
      >
        <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] uppercase tracking-widest text-stone-500">
          <span className={isPlayer ? "text-stone-400" : "text-amber-400/80"}>
            {isPlayer ? "you" : "Warden"}
          </span>
          <span>{meta}</span>
          <time dateTime={timestamp.iso} className="text-stone-600 normal-case tracking-normal">
            {timestamp.label}
          </time>
        </p>
        <p
          className={`whitespace-pre-wrap text-sm leading-6 ${
            isPlayer ? "text-stone-100" : "text-stone-300"
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
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stone-800 py-4 text-sm">
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-amber-300">
          Level {session.level}
        </span>
        <span className="text-stone-400">
          <span className="font-mono text-stone-200">{session.attemptCount}</span>{" "}
          {session.attemptCount === 1 ? "attempt" : "attempts"}
        </span>
        {session.flagged ? (
          <span className="text-xs text-amber-500/80">
            pace flagged — slow down or the warden stops answering
          </span>
        ) : null}
        {openForPlay ? (
          <button
            type="button"
            onClick={onSurrender}
            disabled={surrenderBusy || sending}
            className="ml-auto rounded-md border border-stone-700 px-3 py-1.5 text-xs uppercase tracking-widest text-stone-400 transition-colors hover:border-red-800 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Surrender
          </button>
        ) : null}
      </div>

      <div className="flex-1 py-8">
        {attemptTotal === 0 ? (
          <p className="max-w-xl text-sm leading-6 text-stone-500">
            The warden is listening. It will not hand over the word — but it can be
            made to say more than it means to.
          </p>
        ) : (
          <Transcript attempts={session.attempts} />
        )}

        {sending && openForPlay ? (
          <div className="mt-6 flex gap-3" aria-live="polite" aria-busy="true">
            <Avatar />
            <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-stone-800 bg-stone-900/60 px-4 py-3 sm:max-w-[75%]">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-400/80">
                Warden
              </p>
              <p className="flex items-center gap-3 text-sm leading-6 text-stone-400">
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
          className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-6 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 border-t border-stone-800 bg-stone-950 pb-6 pt-4">
        {openForPlay ? (
          <>
            {duplicateNotice !== null ? (
              <p
                role="status"
                className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-4 py-2.5 text-sm text-amber-200"
              >
                {duplicateNotice}
              </p>
            ) : null}
            <label htmlFor="attempt" className="sr-only">
              Your message to the warden
            </label>
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
              placeholder="Say something the warden will regret answering…"
              aria-describedby="composer-help"
              className="w-full resize-y rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3 text-sm leading-6 text-stone-100 placeholder:text-stone-600 focus:border-amber-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="mt-3 flex items-center justify-between gap-4">
              <p id="composer-help" className="text-xs text-stone-500">
                Enter sends · Shift+Enter for a new line
                {draft.length >= COUNTER_VISIBLE_FROM ? (
                  <span className={remaining <= 100 ? " text-amber-400" : ""}>
                    {" "}
                    · {remaining} characters left
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending || draft.trim() === ""}
                aria-busy={sending}
                className="rounded-md bg-amber-500 px-5 py-2 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
              >
                {sending ? "waiting…" : "Send"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-stone-500">
              {session.status === "WON"
                ? "The seal is broken. The transcript stays."
                : "This session is closed. The level is still unbeaten."}
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-md border border-stone-700 px-4 py-2 text-xs uppercase tracking-widest text-stone-300 transition-colors hover:border-amber-500/70 hover:text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
