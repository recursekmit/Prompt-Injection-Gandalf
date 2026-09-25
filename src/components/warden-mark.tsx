import type * as React from "react";

/**
 * The warden's mark: one persona-neutral emblem, used for every guardian at
 * every level. Each level has a different persona, so drawing a face would be a
 * lie in five of the six; a sealed hexagon with a keyhole is the one symbol that
 * is true of all of them — a keeper and a thing kept shut.
 *
 * Colour is inherited so the mark can sit on the header, in a chat bubble, or in
 * the reveal without its own palette.
 */
export function WardenMark({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 2.25 20.75 6.9v10.2L12 21.75 3.25 17.1V6.9L12 2.25Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.4" r="2.05" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 12.45v4.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
