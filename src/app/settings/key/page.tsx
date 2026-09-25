import { redirect } from "next/navigation";
import type * as React from "react";
import { GroqKeyForm } from "@/components/groq-key-form";
import { SiteHeader } from "@/components/site-header";
import { hasGroqKey } from "@/lib/account/groq-key";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function KeySettingsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect("/login");

  const keyPresent = await hasGroqKey(session.user.id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg px-6 py-12">
        <h1 className="font-display text-2xl font-semibold text-stone-100">Your Groq key</h1>
        <p className="mt-2 mb-6 text-sm text-stone-400">
          PromptGuard runs the guardian on your own Groq key. Get one free at{" "}
          <a href="https://console.groq.com/keys" className="text-amber-400 hover:text-amber-300">
            console.groq.com/keys
          </a>
          . It is stored encrypted and never shown again.
        </p>
        <GroqKeyForm hasKey={keyPresent} />
      </main>
    </>
  );
}
