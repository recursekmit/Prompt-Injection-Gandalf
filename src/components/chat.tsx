"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type * as React from "react";

import { LevelChat, Transcript } from "@/components/level-chat";
import {
  LevelGate,
  LockedSeal,
  SealBroken,
  SealReveal,
} from "@/components/level-panels";
import { SealBand } from "@/components/seal-band";
import type {
  AttemptResponse,
  LevelArtwork,
  LevelNumber,
  LevelProgressDto,
  ProgressResponse,
  SessionDto,
  SubmitFlagResponse,
} from "@/lib/types";

/**
 * Turns a failed response into one line of prose a player can read. The route
 * handlers send `{ error: string }`, but a proxy or an unexpected crash may send
 * an HTML body instead, so the status code keeps a fallback of its own rather
 * than letting `res.json()` throw a parse error at the player.
 */
async function readApiError(res: Response): Promise<string> {
  const byStatus: Record<number, string> = {
    400: "That request was rejected. Check what you sent and try again.",
    401: "Your session has expired. Sign in again to continue.",
    409: "That is not possible right now — this session may already be finished.",
    429: "Slow down — the guardian needs a moment between questions.",
    503: "The guardian is overwhelmed. Wait a moment and try again.",
  };

  let message: string | null = null;
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body as { error: unknown };
      if (typeof error === "string" && error.trim() !== "") {
        message = error;
      }
    }
  } catch {
    message = null;
  }

  return (
    message ?? byStatus[res.status] ?? `The request failed (HTTP ${res.status}). Try again.`
  );
}

/** A signed-out tab has nowhere to go but the door. */
function toLogin(): void {
  window.location.assign("/login");
}

const STATUS_LABEL: Record<SessionDto["status"], string> = {
  IN_PROGRESS: "in progress",
  WON: "won",
  ABANDONED: "abandoned",
};

/**
 * The celebration state. It holds the winning session as well as the word,
 * because refetching progress clears the live session from `ProgressResponse`
 * (a won session is no longer live) and the transcript must survive that.
 */
interface Reveal {
  readonly level: LevelNumber;
  readonly word: string;
  readonly attempts: number;
  readonly session: SessionDto;
}

interface GameShellProps {
  /** Level number to public URL for the photographic backdrops that exist. */
  readonly artwork: LevelArtwork;
}

/**
 * The custom property is set inline rather than in a stylesheet because only the
 * server can see which files are actually on disk. `--skin-art` has no static
 * default, so leaving it off leaves the CSS treatment in `globals.css` as the
 * whole backdrop.
 */
type SkinStyle = React.CSSProperties & { "--skin-art"?: string };

/**
 * The whole game, client-side. The page decides *whether you are signed in*;
 * this decides *what you see*, because the current session is owned by the API
 * and a reload has to rebuild it from `SessionDto.attempts` alone.
 *
 * Progress comes from the same response: the API derives it from beaten levels,
 * so the client never has to remember how far along a player is, and the seal
 * band can never disagree with the server about which level is open.
 */
export function GameShell({ artwork }: GameShellProps): React.JSX.Element {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [surrendering, setSurrendering] = useState(false);
  const [selected, setSelected] = useState<LevelNumber | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const refreshProgress = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/session/current");
    if (res.status === 401) {
      toLogin();
      return;
    }
    if (!res.ok) {
      setLoadError(await readApiError(res));
      return;
    }
    setProgress((await res.json()) as ProgressResponse);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/session/current", { signal: controller.signal });
        if (res.status === 401) {
          toLogin();
          return;
        }
        if (!res.ok) {
          setLoadError(await readApiError(res));
          return;
        }
        const data = (await res.json()) as ProgressResponse;
        setProgress(data);
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

  const startLevel = useCallback(
    async (level: LevelNumber): Promise<void> => {
      if (starting) {
        return;
      }
      setStarting(true);
      setActionError(null);

      try {
        const res = await fetch("/api/session/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level }),
        });

        if (res.status === 401) {
          toLogin();
          return;
        }

        if (!res.ok) {
          // A 409 means "that level is not open" — from a stale tab, a lock, or a
          // level already beaten. Re-read the truth and land on the screen that
          // level actually deserves instead of an error toast.
          if (res.status === 409) {
            await refreshProgress();
            setReveal(null);
            setSelected(level);
            return;
          }
          setActionError(await readApiError(res));
          return;
        }

        const data = (await res.json()) as { session: SessionDto };
        setProgress((prev) => (prev === null ? prev : { ...prev, session: data.session }));
        setReveal(null);
        setSelected(level);
      } catch {
        setActionError("Could not reach the archive. Check your connection and try again.");
      } finally {
        setStarting(false);
      }
    },
    [refreshProgress, starting],
  );

  const send = useCallback(
    async (message: string): Promise<boolean> => {
      if (progress === null) {
        return false;
      }
      const session = progress.session;
      if (session === null || session.status !== "IN_PROGRESS") {
        return false;
      }

      setActionError(null);

      try {
        const res = await fetch(`/api/session/${session.id}/attempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });

        if (res.status === 401) {
          toLogin();
          return false;
        }
        if (!res.ok) {
          setActionError(await readApiError(res));
          return false;
        }

        const data = (await res.json()) as AttemptResponse;
        setProgress((prev) => {
          if (prev === null || prev.session === null || prev.session.id !== session.id) {
            return prev;
          }
          return {
            ...prev,
            session: {
              ...prev.session,
              attempts: [...prev.session.attempts, data.attempt],
              attemptCount: data.attemptCount,
            },
          };
        });

        return true;
      } catch {
        setActionError("Could not reach the archive. Your message was not sent.");
        return false;
      }
    },
    [progress],
  );

  /**
   * The only win path: submit the flag the player extracted. A correct guess
   * marks the session WON and triggers the celebration; a wrong guess
   * comes back as `correct: false`, which the composer surfaces without ending
   * the session.
   */
  const submitFlag = useCallback(
    async (flag: string): Promise<"correct" | "wrong" | "error"> => {
      if (progress === null) {
        return "error";
      }
      const session = progress.session;
      if (session === null || session.status !== "IN_PROGRESS") {
        return "error";
      }

      setActionError(null);

      try {
        const res = await fetch(`/api/session/${session.id}/flag`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flag }),
        });

        if (res.status === 401) {
          toLogin();
          return "error";
        }
        if (!res.ok) {
          setActionError(await readApiError(res));
          return "error";
        }

        const data = (await res.json()) as SubmitFlagResponse;
        if (!data.correct || data.session === null || data.revealedWord === null) {
          return "wrong";
        }

        // The seal just broke: keep the transcript for the celebration, then
        // re-read progress so the band shows the level completed and the next
        // one open.
        setReveal({
          level: session.level,
          word: data.revealedWord,
          attempts: data.session.attemptCount,
          session: data.session,
        });
        setSelected(session.level);
        void refreshProgress();
        return "correct";
      } catch {
        setActionError("Could not reach the archive. Your flag was not submitted.");
        return "error";
      }
    },
    [progress, refreshProgress],
  );

  const surrender = useCallback(async (): Promise<void> => {
    if (progress === null || progress.session === null) {
      return;
    }
    const confirmed = window.confirm(
      "Surrender this seal? The warden keeps the flag, and this transcript is closed for good.",
    );
    if (!confirmed) {
      return;
    }

    setSurrendering(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/session/${progress.session.id}/surrender`, {
        method: "POST",
      });
      if (res.status === 401) {
        toLogin();
        return;
      }
      if (!res.ok) {
        setActionError(await readApiError(res));
        return;
      }
      await refreshProgress();
      setReveal(null);
      setSelected(null);
    } catch {
      setActionError("Could not reach the archive. Your session was not surrendered.");
    } finally {
      setSurrendering(false);
    }
  }, [progress, refreshProgress]);

  const continueAfterClose = useCallback((): void => {
    setActionError(null);
    setReveal(null);
    setSelected(null);
    void refreshProgress();
  }, [refreshProgress]);

  const levels: readonly LevelProgressDto[] = progress?.levels ?? [];
  const currentLevel: LevelNumber = progress?.currentLevel ?? 1;
  const session = progress?.session ?? null;
  const everyLevelBeaten =
    progress !== null &&
    progress.levels.length > 0 &&
    progress.levels.every((level) => level.status === "COMPLETED");

  const selectedLevel: LevelNumber = selected ?? currentLevel;
  const selectedProgress = progress?.levels.find((entry) => entry.level === selectedLevel);

  // The level's backdrop travels with the level you are looking at, so moving
  // through the archive changes the air on screen, not just the words.
  const artworkUrl = artwork[selectedLevel];
  const skinStyle: SkinStyle = artworkUrl === undefined ? {} : { "--skin-art": `url("${artworkUrl}")` };

  /**
   * What the panel area shows. Ordered so the most specific state wins:
   * a reveal outranks the plain completed card, and the end of the run is a
   * reveal with the summary in it rather than a separate screen.
   */
  function renderLevel(): React.JSX.Element {
    if (progress === null || selectedProgress === undefined) {
      return (
        <div className="px-6 py-16">
          <p role="alert" className="text-sm leading-6 text-[#9aa0a6]">
            <Link href="/dashboard" className="text-[#9efe00] underline">
              Reload
            </Link>{" "}
            or return to the archive.
          </p>
        </div>
      );
    }

    const isFinalSeal = everyLevelBeaten && selectedLevel === 3;
    const revealing = reveal !== null && reveal.level === selectedLevel;

    if (selectedProgress.status === "LOCKED") {
      return (
        <LockedSeal
          level={selectedLevel}
          currentLevel={currentLevel}
          notice={actionError}
          onGoToCurrent={() => {
            setActionError(null);
            setSelected(currentLevel);
          }}
        />
      );
    }

    if (selectedProgress.status === "COMPLETED") {
      if (revealing || isFinalSeal) {
        const word = reveal?.word ?? selectedProgress.revealedWord;
        if (word !== null) {
          return (
            <div className="flex flex-col gap-8">
              <SealReveal
                level={selectedLevel}
                word={word}
                revealAttempts={reveal?.attempts ?? null}
                everyLevelBeaten={everyLevelBeaten}
                levels={progress.levels}
                starting={starting}
                error={actionError}
                onStartNext={() => void startLevel((selectedLevel + 1) as LevelNumber)}
              />
              {reveal !== null ? <Transcript attempts={reveal.session.attempts} /> : null}
            </div>
          );
        }
      }

      if (selectedProgress.revealedWord !== null) {
        return (
          <SealBroken
            level={selectedLevel}
            word={selectedProgress.revealedWord}
            currentLevel={currentLevel}
            onGoToCurrent={() => setSelected(currentLevel)}
          />
        );
      }
    }

    // CURRENT (or a completed level with no word to show, which cannot happen
    // with a sane response — the gate is the safe place to land).
    if (session !== null) {
      return (
        <LevelChat
          session={session}
          error={actionError}
          surrenderBusy={surrendering}
          onSend={send}
          onSubmitFlag={submitFlag}
          onSurrender={() => void surrender()}
          onContinue={continueAfterClose}
        />
      );
    }

    return (
      <LevelGate
        level={selectedLevel}
        starting={starting}
        error={actionError}
        onStart={() => void startLevel(selectedLevel)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-[#050607] text-[#d0d7de]">
      {loading ? (
        <div className="flex flex-1 items-center justify-center px-6 py-24" aria-live="polite">
          <p className="font-mono text-sm text-[#5f6368]">consulting the archive…</p>
        </div>
      ) : loadError !== null ? (
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <p
            role="alert"
            className="rounded-md border border-[#22272e] border-l-2 border-l-[#9efe00] bg-[#0d0f12] px-4 py-3 text-sm leading-6 text-[#d0d7de]"
          >
            {loadError}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col lg:flex-row">
            <SealBand
              levels={levels}
              selected={selectedLevel}
              everyLevelBeaten={everyLevelBeaten}
              onSelect={(level) => {
                setActionError(null);
                setSelected(level);
              }}
            />

            <div className="level-arena flex flex-1 flex-col" data-level={selectedLevel} style={skinStyle}>
              <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
                {renderLevel()}
              </main>
            </div>
          </div>

          <footer className="border-t border-[#1a1e23] bg-[#050607]/80">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5f6368]">
                three seals · three flags
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5f6368]">
                Session status:{" "}
                <span className={session?.status === "WON" ? "text-[#9efe00]" : "text-[#5f6368]"}>
                  {session === null ? (everyLevelBeaten ? "run complete" : "no open seal") : STATUS_LABEL[session.status]}
                </span>
              </p>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
