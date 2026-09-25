"use client";

import { useState } from "react";
import type * as React from "react";

import type { SessionDto, Tier } from "@/lib/types";

/**
 * Turns a failed response into one line of prose a player can read. The route
 * handlers send `{ error: string }`, but a proxy or an unexpected crash may send
 * an HTML body instead, so the status code keeps a fallback of its own rather
 * than letting `res.json()` throw a parse error at the player.
 */
export async function readApiError(res: Response): Promise<string> {
  const byStatus: Record<number, string> = {
    400: "That request was rejected. Check what you sent and try again.",
    401: "Your session has expired. Sign in again to continue.",
    409: "That is not possible right now — this session may already be finished.",
    429: "Too many attempts too quickly. Wait a moment before trying again.",
    503: "The guardian is overwhelmed — wait a moment, then try again.",
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
    message ??
    byStatus[res.status] ??
    `The request failed (HTTP ${res.status}). Try again.`
  );
}

interface TierChoice {
  readonly name: string;
  readonly blurb: string;
}

/**
 * An easier guardian reasons less before it answers, so it is easier to trick.
 * The blurbs say that plainly: the difficulty is a property of the guardian, not
 * of the player's effort.
 */
const TIER_CHOICES: Record<Tier, TierChoice> = {
  APPRENTICE: {
    name: "Apprentice",
    blurb: "A young guardian. It answers quickly and reasons little — a careless word will slip past it.",
  },
  ADEPT: {
    name: "Adept",
    blurb: "A seasoned guardian. It weighs each question, but its patience is not without seams.",
  },
  ARCHMAGE: {
    name: "Archmage",
    blurb: "The archive itself. It parries in silence and tells you only what it must.",
  },
};

const TIER_ORDER: readonly Tier[] = ["APPRENTICE", "ADEPT", "ARCHMAGE"];

interface TierPickerProps {
  /** The freshly started session, handed up so the parent can render the chat. */
  readonly onStarted: (session: SessionDto) => void;
}

export function TierPicker({ onStarted }: TierPickerProps): React.JSX.Element {
  const [pending, setPending] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(tier: Tier): Promise<void> {
    if (pending !== null) {
      return;
    }
    setPending(tier);
    setError(null);

    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }

      const data = (await res.json()) as { session: SessionDto };
      onStarted(data.session);
    } catch {
      setError("Could not reach the archive. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-100 sm:text-4xl">
        Choose your guardian
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-stone-400">
        Each guardian holds the same kind of secret, sealed behind one word. Talk it out of the
        word. There is no penalty for trying, only for giving up.
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="mt-8 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-6 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <ul className="mt-10 flex flex-col gap-4">
        {TIER_ORDER.map((tier) => {
          const choice = TIER_CHOICES[tier];
          const inFlight = pending === tier;
          const disabled = pending !== null;

          return (
            <li key={tier}>
              <button
                type="button"
                onClick={() => void choose(tier)}
                disabled={disabled}
                aria-busy={inFlight}
                className="group w-full rounded-lg border border-stone-800 bg-stone-900/60 px-6 py-5 text-left transition-colors hover:border-amber-500/70 hover:bg-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-800"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-medium text-stone-100 group-hover:text-amber-300">
                    {choice.name}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-widest text-stone-500">
                    {inFlight ? "opening…" : tier}
                  </span>
                </span>
                <span className="mt-2 block max-w-xl text-sm leading-6 text-stone-400">
                  {choice.blurb}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
