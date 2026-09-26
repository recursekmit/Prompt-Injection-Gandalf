"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      // The client helper from "next-auth/react", not the server-side one from
      // "@/lib/auth" -- mixing them up is the classic v5 error.
      await signOut({ redirect: false });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded-sm border border-[#22272e] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#9aa0a6] transition-colors hover:border-[#9efe00] hover:text-[#9efe00] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
