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
      router.push("/challenges");
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
      <label className="flex flex-col gap-1.5 text-sm text-[#9aa0a6]">
        {hasKey ? "Replace your Groq API key" : "Your Groq API key"}
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          required
          placeholder="gsk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="rounded-lg border border-[#22272e] bg-[#0d0f12] px-3 py-2 text-[#d0d7de] outline-none focus:border-[#9efe00]"
        />
      </label>
      {error !== null && <p role="alert" className="text-sm text-[#9aa0a6]">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="btn-recurse-primary text-sm disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save key"}
        </button>
        {hasKey && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-[#22272e] px-4 py-2 text-[#9aa0a6] transition-colors hover:border-[#9efe00] hover:text-[#9efe00] disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
