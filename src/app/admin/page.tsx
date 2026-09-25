import type * as React from "react";

/**
 * Interim landing for the console: it exists so `/admin` resolves inside the
 * layout — a segment with a layout but no page returns a bare 404, and the nav
 * the operator asked for would be invisible. The stats themselves replace this
 * body next.
 */
export default function AdminStatsPage(): React.JSX.Element {
  return (
    <section>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-100">Stats</h1>
      <p className="mt-2 text-sm text-stone-400">
        The console is online. The room&rsquo;s numbers land here next.
      </p>
    </section>
  );
}
