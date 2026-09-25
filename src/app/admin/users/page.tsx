import Link from "next/link";
import type * as React from "react";

import { AdminUsersManager } from "@/components/admin-users-manager";
import { requireAdminPage } from "@/lib/admin/require-admin";
import { countUsers, listUsers } from "@/lib/admin/users";

/**
 * Every account, and the four things an operator does to one: add, reset a
 * password, clear a wedged session, delete.
 *
 * `requireAdminPage()` is the FIRST statement and it must stay there. The
 * layout's gate only changes the status code — Next renders this page's subtree
 * before the layout aborts it — so a read that happens first travels to the
 * client inside the body of a 404, and this page reads every player's email.
 *
 * Search and paging are ordinary query parameters read by the server, so this
 * screen needs no client state to be searchable and the operator can bookmark
 * or share a filtered view.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}): Promise<React.JSX.Element> {
  await requireAdminPage();

  const params = await searchParams;
  const search = params.q ?? "";
  const cursor = params.cursor ?? null;

  const [list, total] = await Promise.all([
    listUsers({ q: search, limit: String(PAGE_SIZE), cursor }),
    countUsers(),
  ]);

  /** Builds a next-page link, keeping the current search. */
  function pageHref(next: string): string {
    const query = new URLSearchParams();
    if (search !== "") {
      query.set("q", search);
    }
    query.set("cursor", next);
    return `/admin/users?${query.toString()}`;
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-100">
          Players
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
          {total} account{total === 1 ? "" : "s"}
        </p>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-stone-400">
        A generated password is shown once, here, and never again — only its hash
        is stored. Deletion takes the player&rsquo;s sessions and attempts with
        it, so it reports what went; accounts listed in{" "}
        <code className="font-mono text-xs text-stone-300">ADMIN_EMAILS</code> cannot be
        deleted from this screen, because the console would lock itself out.
      </p>

      <form method="GET" action="/admin/users" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
            Search by email
          </span>
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="player@example.com"
            className="w-72 rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-stone-700 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-stone-300 transition-colors hover:border-stone-500 hover:text-stone-100"
        >
          Search
        </button>
        {search !== "" ? (
          <Link
            href="/admin/users"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500 underline-offset-4 hover:text-stone-300 hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-8">
        <AdminUsersManager users={list.users} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        {cursor !== null ? (
          <Link
            href="/admin/users"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400 underline-offset-4 hover:text-stone-200 hover:underline"
          >
            First page
          </Link>
        ) : null}
        {list.nextCursor !== null ? (
          <Link
            href={pageHref(list.nextCursor)}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400 underline-offset-4 hover:text-amber-300 hover:underline"
          >
            Next page
          </Link>
        ) : null}
        <span className="text-xs text-stone-500">
          Showing {list.users.length} of {total}
          {search === "" ? "" : ` matching “${search}”`}
        </span>
      </div>
    </section>
  );
}
