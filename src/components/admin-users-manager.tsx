"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type * as React from "react";

import type { AdminUserRow } from "@/lib/types";

/**
 * The console's user table and the operations on it.
 *
 * A client component only because these are four writes with their own state:
 * a form, a confirmation, and a password that has to be shown exactly once and
 * not be lost. The reading is done by the page above it, server-side.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 * - The revealed password is a panel that stays until dismissed, not a toast. It
 *   cannot be retrieved again, and a message that disappears takes the only copy
 *   of a player's password with it.
 * - A failed action reports itself without clearing the table or the search.
 *   Losing the operator's place because one delete was refused is how a screen
 *   becomes unusable during an event.
 */

interface Revealed {
  readonly email: string;
  readonly password: string;
  readonly note: string;
}

interface Notice {
  readonly message: string;
}

const BUTTON =
  "font-mono text-[11px] uppercase tracking-[0.15em] text-stone-400 underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50";

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body as { error?: unknown };
      if (typeof error === "string" && error !== "") {
        return error;
      }
    }
  } catch {
    // Fall through to the status-based message below.
  }
  return `The console got ${response.status} from the server.`;
}

export function AdminUsersManager({
  users,
}: {
  readonly users: readonly AdminUserRow[];
}): React.JSX.Element {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Notice | null>(null);
  /** Not an error: what a delete actually took with it. */
  const [notice, setNotice] = useState<Notice | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  function reset(): void {
    setFailure(null);
    setNotice(null);
    setConfirmingDelete(null);
    setDeleteConfirmation("");
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("create");
    reset();

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: password === "" ? undefined : password }),
      });

      if (!response.ok) {
        setFailure({ message: await readError(response) });
        return;
      }

      const created = (await response.json()) as { user: AdminUserRow; password: string };
      setRevealed({
        email: created.user.email,
        password: created.password,
        note: "Created. This is the only time this password is shown.",
      });
      setEmail("");
      setPassword("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleReset(row: AdminUserRow): Promise<void> {
    setBusy(`reset:${row.id}`);
    reset();

    try {
      const response = await fetch(`/api/admin/users/${row.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        setFailure({ message: await readError(response) });
        return;
      }

      const result = (await response.json()) as { email: string; password: string };
      setRevealed({
        email: result.email,
        password: result.password,
        note: "Password reset. Their old one no longer works.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleAbandon(row: AdminUserRow): Promise<void> {
    setBusy(`session:${row.id}`);
    reset();

    try {
      const response = await fetch(`/api/admin/users/${row.id}/session`, { method: "DELETE" });
      if (!response.ok) {
        setFailure({ message: await readError(response) });
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(row: AdminUserRow): Promise<void> {
    setBusy(`delete:${row.id}`);

    try {
      setNotice(null);
      const response = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      if (!response.ok) {
        setFailure({ message: await readError(response) });
        setConfirmingDelete(null);
        return;
      }

      const result = (await response.json()) as {
        email: string;
        sessionsDeleted: number;
        attemptsDeleted: number;
      };
      setNotice({
        message: `Deleted ${result.email}, along with ${result.sessionsDeleted} session(s) and ${result.attemptsDeleted} attempt(s). That history is gone.`,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="player@example.com"
            className="w-72 rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
            Password (blank generates one)
          </span>
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="leave blank"
            autoComplete="off"
            className="w-56 rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded border border-amber-400/60 bg-amber-400/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-200 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
        >
          {busy === "create" ? "Creating…" : "Add player"}
        </button>
      </form>

      {revealed !== null ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 px-5 py-4"
        >
          <p className="text-sm text-amber-100">{revealed.note}</p>
          <p className="mt-2 text-sm text-stone-300">{revealed.email}</p>
          <p className="mt-1 font-mono text-lg tracking-wide text-amber-200 select-all">
            {revealed.password}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.password);
              }}
              className={BUTTON}
            >
              Copy password
            </button>
            <button type="button" onClick={() => setRevealed(null)} className={BUTTON}>
              I have written it down — dismiss
            </button>
          </div>
        </div>
      ) : null}

      {failure !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-400/40 bg-red-400/5 px-5 py-4 text-sm text-red-100"
        >
          {failure.message}
        </p>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-stone-700 bg-stone-900/60 px-5 py-4 text-sm text-stone-300"
        >
          {notice.message}
        </p>
      ) : null}

      {users.length === 0 ? (
        <p className="mt-8 rounded-lg border border-stone-800 bg-stone-900/40 px-5 py-6 text-sm text-stone-400">
          No accounts match.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead className="bg-stone-900/60">
              <tr className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
                <th scope="col" className="px-4 py-3 font-normal">Player</th>
                <th scope="col" className="px-4 py-3 font-normal">Created</th>
                <th scope="col" className="px-4 py-3 font-normal">Level</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Attempts</th>
                <th scope="col" className="px-4 py-3 font-normal">Last activity</th>
                <th scope="col" className="px-4 py-3 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} className="border-t border-stone-800/80 align-top">
                  <th scope="row" className="px-4 py-3 text-left text-sm font-normal text-stone-200">
                    {row.email}
                  </th>
                  <td className="px-4 py-3 font-mono text-xs text-stone-500">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-stone-300">
                    {row.currentLevel}
                    <span className="text-stone-600">/6</span>
                    {row.levelsCompleted > 0 ? (
                      <span className="ml-2 font-mono text-xs text-amber-200/80">
                        {row.levelsCompleted} won
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-stone-400">
                    {row.totalAttempts}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-500">
                    {row.lastActivityAt === null
                      ? "never"
                      : new Date(row.lastActivityAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <button
                        type="button"
                        onClick={() => void handleReset(row)}
                        disabled={busy !== null}
                        className={BUTTON}
                      >
                        {busy === `reset:${row.id}` ? "Resetting…" : "Reset password"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAbandon(row)}
                        disabled={busy !== null}
                        className={BUTTON}
                      >
                        {busy === `session:${row.id}` ? "Clearing…" : "Clear live session"}
                      </button>

                      {confirmingDelete === row.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2">
                            <span className="text-xs text-stone-400">
                              Type {row.email} to delete
                            </span>
                            <input
                              type="text"
                              value={deleteConfirmation}
                              onChange={(event) => setDeleteConfirmation(event.target.value)}
                              className="w-56 rounded border border-red-400/40 bg-stone-900 px-2 py-1 font-mono text-xs text-stone-100 focus:border-red-400 focus:outline-none"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            disabled={deleteConfirmation !== row.email || busy !== null}
                            className={`${BUTTON} text-red-300 hover:text-red-200`}
                          >
                            {busy === `delete:${row.id}` ? "Deleting…" : "Delete for good"}
                          </button>
                          <button
                            type="button"
                            onClick={reset}
                            className={BUTTON}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            setConfirmingDelete(row.id);
                          }}
                          disabled={busy !== null}
                          className={`${BUTTON} text-red-300/90 hover:text-red-200`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
