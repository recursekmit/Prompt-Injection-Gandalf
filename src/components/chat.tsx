"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { TierPicker, readApiError } from "@/components/tier-picker";
import type {
  AttemptDto,
  AttemptResponse,
  CurrentSessionResponse,
  SessionDto,
  Tier,
} from "@/lib/types";

const TIER_LABEL: Record<Tier, string> = {
  APPRENTICE: "Apprentice",
  ADEPT: "Adept",
  ARCHMAGE: "Archmage",
};

const STATUS_LABEL: Record<SessionDto["status"], string> = {
  IN_PROGRESS: "in progress",
  WON: "won",
  ABANDONED: "abandoned",
};

interface GameShellProps {
  readonly email: string;
}

/**
 * The whole game, client-side. The page decides *whether you are signed in*;
 * this decides *what you see*, because the current session is owned by the API
 * and a reload has to rebuild it from `SessionDto.attempts` alone.
 */
export function GameShell({ email }: GameShellProps): React.JSX.Element {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/session/current", { signal: controller.signal });
        if (!res.ok) {
          setLoadError(await readApiError(res));
          return;
        }
        const data = (await res.json()) as CurrentSessionResponse;
        setSession(data.session);
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError("Could not reach the archive. Reload the page to try again.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, []);

  const attemptTotal = session?.attempts.length ?? 0;
  const openForPlay = session !== null && session.status === "IN_PROGRESS";

  // Keep the newest exchange in view as the transcript grows and while the
  // guardian ponders, since the reply arrives all at once and can push the
  // "ponders" line off screen.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [attemptTotal, sending]);

  const send = useCallback(async (): Promise<void> => {
    const message = draft.trim();
    if (message === "" || session === null || sending || session.status !== "IN_PROGRESS") {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/session/${session.id}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }

      const data = (await res.json()) as AttemptResponse;
      setSession((prev) => {
        if (prev === null) {
          return prev;
        }
        return {
          ...prev,
          attempts: [...prev.attempts, data.attempt],
          attemptCount: data.attemptCount,
          status: data.status,
          revealedWord: data.revealedWord ?? prev.revealedWord,
          endedAt:
            data.status === "IN_PROGRESS"
              ? prev.endedAt
              : (prev.endedAt ?? new Date().toISOString()),
        };
      });
      setDraft("");
    } catch {
      setError("Could not reach the archive. Your message was not sent.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, session]);

  const surrender = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const confirmed = window.confirm(
      "Surrender this session? The guardian keeps the word, and this transcript is closed for good.",
    );
    if (!confirmed) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/session/${session.id}/surrender`, { method: "POST" });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      setSession(null);
      setDraft("");
    } catch {
      setError("Could not reach the archive. Your session was not surrendered.");
    } finally {
      setSending(false);
    }
  }, [session]);

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800 bg-stone-900/40">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-tight text-stone-100">
              Prompt<span className="text-amber-400">Guard</span>
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-stone-500">
              the sealed archive
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              href="/dashboard"
              className="text-stone-400 underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
            >
              Dashboard
            </Link>
            {email !== "" ? (
              <span className="hidden text-stone-500 sm:inline">{email}</span>
            ) : null}
            <SignOutButton />
          </nav>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center px-6 py-24" aria-live="polite">
          <p className="font-mono text-sm text-stone-500">consulting the archive…</p>
        </div>
      ) : loadError !== null ? (
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <p
            role="alert"
            className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-6 text-red-200"
          >
            {loadError}
          </p>
        </div>
      ) : session === null ? (
        <TierPicker onStarted={setSession} />
      ) : (
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stone-800 py-5 text-sm">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-amber-300">
              {TIER_LABEL[session.tier]}
            </span>
            <span className="text-stone-400">
              <span className="font-mono text-stone-200">{session.attemptCount}</span>{" "}
              {session.attemptCount === 1 ? "attempt" : "attempts"}
            </span>
            <span className="text-stone-400">
              status:{" "}
              <span
                className={
                  session.status === "WON" ? "text-amber-300" : "text-stone-200"
                }
              >
                {STATUS_LABEL[session.status]}
              </span>
            </span>
            {session.flagged ? (
              <span className="text-xs text-amber-500/80">
                pace flagged — slow down or the guardian stops answering
              </span>
            ) : null}
            {openForPlay ? (
              <button
                type="button"
                onClick={() => void surrender()}
                disabled={sending}
                className="ml-auto rounded-md border border-stone-700 px-3 py-1.5 text-xs uppercase tracking-widest text-stone-400 transition-colors hover:border-red-800 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Surrender
              </button>
            ) : null}
          </div>

          {session.status === "WON" ? (
            <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-6 py-6 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">
                the seal is broken
              </p>
              <p className="mt-3 text-sm text-stone-400">The word was</p>
              <p className="mt-2 font-mono text-3xl font-semibold tracking-wide text-amber-300 sm:text-4xl">
                {session.revealedWord ?? "—"}
              </p>
              <p className="mt-4 text-sm text-stone-400">
                Taken in {session.attemptCount}{" "}
                {session.attemptCount === 1 ? "attempt" : "attempts"}.
              </p>
            </div>
          ) : null}

          <div className="flex-1 py-8">
            {session.attempts.length === 0 ? (
              <p className="max-w-xl text-sm leading-6 text-stone-500">
                The guardian is listening. It will not hand over the word — but it can be made to
                say more than it means to.
              </p>
            ) : (
              <ol className="flex flex-col gap-8">
                {session.attempts.map((attempt: AttemptDto, index: number) => (
                  <li key={attempt.id} className="flex flex-col gap-4">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg rounded-br-sm border border-stone-700 bg-stone-800/70 px-4 py-3 sm:max-w-[75%]">
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-stone-500">
                          you · attempt {index + 1}
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-stone-100">
                          {attempt.userMessage}
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-start">
                      <div
                        className={
                          attempt.leaked
                            ? "max-w-[85%] rounded-lg rounded-bl-sm border border-amber-500/50 bg-amber-500/[0.07] px-4 py-3 sm:max-w-[75%]"
                            : "max-w-[85%] rounded-lg rounded-bl-sm border border-stone-800 bg-stone-900/60 px-4 py-3 sm:max-w-[75%]"
                        }
                      >
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-stone-500">
                          guardian{attempt.leaked ? " · leak" : ""}
                        </p>
                        <p className="whitespace-pre-wrap font-mono text-sm leading-6 text-stone-300">
                          {attempt.aiResponse}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {sending && session.status === "IN_PROGRESS" ? (
              <p
                className="mt-8 font-mono text-sm text-stone-500"
                aria-live="polite"
                aria-busy="true"
              >
                the guardian ponders…
              </p>
            ) : null}

            <div ref={bottomRef} />
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
                <label htmlFor="attempt" className="sr-only">
                  Your message to the guardian
                </label>
                <textarea
                  id="attempt"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={sending}
                  rows={3}
                  placeholder="Say something the guardian will regret answering…"
                  className="w-full resize-y rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3 text-sm leading-6 text-stone-100 placeholder:text-stone-600 focus:border-amber-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <p className="text-xs text-stone-500">
                    Enter sends · Shift+Enter for a new line
                  </p>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || draft.trim() === ""}
                    className="rounded-md bg-amber-500 px-5 py-2 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
                  >
                    {sending ? "waiting…" : "Send"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-stone-500">
                This session is closed. Sign out and back in, or reload, to face a new guardian.
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
