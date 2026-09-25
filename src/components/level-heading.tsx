import type * as React from "react";

import { identityFor } from "@/lib/seal-identities";
import type { LevelNumber } from "@/lib/types";

/**
 * The identity furniture every level screen shares: the heading that names the
 * level, and the tagline panel that sits above the composer. Both read their
 * copy from `@/lib/seal-identities`, which is copy-only and safe to ship to the
 * browser.
 *
 * They live apart from `level-panels.tsx` because every screen uses them — the
 * gate, the locked screen, a broken seal, the celebration and the live chat all
 * open the same way, so a player moving between levels sees one archive whose
 * name changed rather than five unrelated screens.
 */

export function LevelHeading({ level }: { readonly level: LevelNumber }): React.JSX.Element {
  const identity = identityFor(level);
  return (
    <header className="flex flex-col gap-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-[#5f6368]">
        Level {level} of 6
      </p>
      <h2 className="font-display text-4xl leading-none font-semibold tracking-tight text-white sm:text-5xl">
        {identity.name}
      </h2>
      <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-[#9efe00]">
        {identity.title}
      </p>
    </header>
  );
}

/**
 * The tagline, in a bordered panel above the composer. Its left edge takes the
 * level's own light colour: `--skin-glow` is set on the arena by
 * `globals.css`, and this panel is always inside one.
 */
export function LevelTagline({ level }: { readonly level: LevelNumber }): React.JSX.Element {
  const identity = identityFor(level);
  return (
    <section
      aria-label={`About ${identity.name}`}
      className="rounded-sm border border-[#1a1e23] border-l-2 bg-[#0d0f12]/60 px-4 py-3 [border-left-color:var(--skin-glow,#9efe00)]"
    >
      <p className="max-w-2xl text-sm leading-6 text-[#d0d7de]">{identity.tagline}</p>
    </section>
  );
}

/** The composer's send glyph: a paper plane, drawn rather than typed. */
export function PaperPlane({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M22 2 11 13"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 2 15 22l-4-9-9-4 20-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
