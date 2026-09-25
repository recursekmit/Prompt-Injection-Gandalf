"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
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
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error !== undefined && result.error !== null) {
        // Deliberately vague: never reveal whether the email exists.
        setError("Wrong email or password.");
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
        <span className="terminal-tag">ACCESS THE ARCHIVE</span>
        <h1 className="font-sans text-2xl font-extrabold text-white">Sign in</h1>
        <p className="font-sans text-sm text-[#9aa0a6]">
          Welcome back to PromptGuard.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field"
          />
        </label>

        {error !== null && (
          <p role="alert" className="font-sans text-sm text-[#fca5a5]">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-recurse-primary w-full">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => signIn("github", { callbackUrl: "/challenges" })}
        className="btn-recurse-secondary w-full"
      >
        Continue with GitHub
      </button>

      <p className="font-sans text-sm text-[#9aa0a6]">
        Need an account?{" "}
        <Link href="/signup" className="text-[#9efe00] hover:text-[#adff00]">
          Sign up
        </Link>
      </p>
    </div>
  );
}
