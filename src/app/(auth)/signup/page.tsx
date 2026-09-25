"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

export default function SignupPage() {
  const router = useRouter();
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
        body: JSON.stringify({ email, password }),
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

      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-stone-100">Create account</h1>
        <p className="text-sm text-stone-400">
          PromptGuard needs an account to track your attempts.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-stone-300">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none placeholder:text-stone-600 focus:border-amber-500"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-stone-300">
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none placeholder:text-stone-600 focus:border-amber-500"
          />
          <span className="text-xs text-stone-500">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
        </label>

        {error !== null && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-stone-400">
        Already have an account?{" "}
        <Link href="/login" className="text-amber-500 hover:text-amber-400">
          Log in
        </Link>
      </p>
    </div>
  );
}
