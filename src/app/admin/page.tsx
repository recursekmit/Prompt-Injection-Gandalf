import type * as React from "react";

import { requireAdminPage } from "@/lib/admin/require-admin";

/**
 * The console's landing page. The stats tables land here next; this body exists
 * so that `/admin` resolves inside the layout at all.
 *
 * `requireAdminPage()` is the first statement, before this page reads anything,
 * and that order is load-bearing rather than tidy: the layout's own gate changes
 * the status code but still ships whatever this page has already fetched and
 * rendered. See the note on `requireAdminPage` for the measurement.
 */
export default async function AdminStatsPage(): Promise<React.JSX.Element> {
  await requireAdminPage();

  return (
    <section>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-100">Stats</h1>
      <p className="mt-2 text-sm text-stone-400">
        The console is online. The room&rsquo;s numbers land here next.
      </p>
    </section>
  );
}
