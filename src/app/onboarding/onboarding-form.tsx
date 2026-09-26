"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [rollNumber, setRollNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rollNumber }),
      });

      if (res.ok) {
        router.push("/challenges");
        router.refresh();
        return;
      }

      const data: unknown = await res.json().catch(() => null);
      const message =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Something went wrong. Try again.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 font-mono text-xs uppercase tracking-wide text-[#9aa0a6]">
        Name
        <input
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="input-field"
        />
      </label>

      <label className="flex flex-col gap-1.5 font-mono text-xs uppercase tracking-wide text-[#9aa0a6]">
        Roll number
        <input
          type="text"
          name="rollNumber"
          placeholder="21BD1A0501"
          maxLength={10}
          required
          value={rollNumber}
          onChange={(event) => setRollNumber(event.target.value.toUpperCase())}
          className="input-field"
        />
      </label>

      {error !== null && (
        <p role="alert" className="font-sans text-sm text-[#fca5a5]">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-recurse-primary w-full">
        {pending ? "SUBMITTING…" : "ENTER THE ARCHIVE"}
      </button>
    </form>
  );
}
