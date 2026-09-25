"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Add / replace / remove the player's Groq key. Write-only: the key is never
 * fetched back, `hasKey` is all the client is told.
 */
export function GroqKeyForm({ hasKey }: { hasKey: boolean }): React.JSX.Element {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/groq-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save that key.");
        return;
      }
      setApiKey("");
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch("/api/account/groq-key", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-stone-300">
        {hasKey ? "Replace your Groq API key" : "Your Groq API key"}
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          required
          placeholder="gsk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
      </label>
      {error !== null && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save key"}
        </button>
        {hasKey && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-stone-700 px-4 py-2 text-stone-300 hover:border-stone-500 disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
