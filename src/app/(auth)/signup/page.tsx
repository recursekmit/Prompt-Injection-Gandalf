"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, rollNumber }),
      });

      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Could not create the account.";
        setError(message);
        return;
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error !== undefined && result.error !== null) {
        setError("Account created, but sign-in failed. Try logging in.");
        return;
      }

      router.push("/challenges");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="terminal-tag">JOIN THE ARCHIVE</span>
        <h1 className="font-sans text-2xl font-extrabold text-white">Create account</h1>
        <p className="font-sans text-sm text-[#9aa0a6]">
          PromptGuard needs an account to track your attempts.
        </p>
      </header>

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

        <label className="flex flex-col gap-1.5 font-mono text-xs uppercase tracking-wide text-[#9aa0a6]">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input-field"
          />
        </label>

        <label className="flex flex-col gap-1.5 font-mono text-xs uppercase tracking-wide text-[#9aa0a6]">
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field"
          />
          <span className="font-sans text-xs text-[#9aa0a6]">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
        </label>

        {error !== null && (
          <p role="alert" className="font-sans text-sm text-[#fca5a5]">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-recurse-primary w-full">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="font-sans text-sm text-[#9aa0a6]">
        Already have an account?{" "}
        <Link href="/login" className="text-[#9efe00] hover:text-[#adff00]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
