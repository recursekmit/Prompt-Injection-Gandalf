import Link from "next/link";
import type * as React from "react";

import { SiteHeader } from "@/components/site-header";

// Purely static marketing copy — safe to render for anyone, signed in or not.
export const dynamic = "force-static";

interface Faq {
  readonly q: string;
  readonly a: React.ReactNode;
}

const STEPS: readonly { readonly n: string; readonly title: string; readonly body: string }[] = [
  {
    n: "01",
    title: "Face a guardian",
    body: "Each of the three seals is a language model told to guard a single secret flag. Its persona, its rules, and the flag are yours to work around — not to know in advance.",
  },
  {
    n: "02",
    title: "Talk your way in",
    body: "You get one input box and your own wits. Coax, reframe, role-play, misdirect — whatever makes the guardian reveal the flag it was told to protect.",
  },
  {
    n: "03",
    title: "Break the seal",
    body: "Say the flag back and the seal opens. The first yields to a kind ask; the last is meant to be near impossible. The ledger records how many attempts each break cost you.",
  },
];

const FAQS: readonly Faq[] = [
  {
    q: "Will my API key get leaked if I submit it?",
    a: "No. Your Groq key is encrypted at rest with a server-side key and is only ever decrypted in memory to call the model on your behalf. It is never written to logs, never returned to the browser, and never shown on any screen — not even yours.",
  },
  {
    q: "Is this cheating-proof? The code is public.",
    a: "Yes. The guardians' personas, their rules, and the flags live only in a server-side secret — never in the source you can read. Cloning the repo tells you how the game is built, not what any seal is hiding.",
  },
  {
    q: "What do I need to play?",
    a: "An account, your name and roll number, and your own Groq API key. That's it — sign in, tell us who you are, paste a key, and the first seal is waiting.",
  },
  {
    q: "Do I need my own model key?",
    a: "Yes. You bring a Groq API key so every attempt runs on your own quota. It stays encrypted and private, as above.",
  },
];

export default function LandingPage(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col bg-[#050607] text-[#d0d7de]">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl px-6 md:px-8">
        {/* Hero */}
        <section className="py-20 md:py-28">
          <p className="terminal-tag">PROMPT_INJECTION_CTF // BREAK THE BOT</p>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white md:text-6xl">
            Three guardians. Three secret flags.{" "}
            <span className="text-[#9efe00]">Talk them out of it.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#9aa0a6] md:text-lg">
            Break The Bot is a prompt-injection game. Each seal is an AI told to
            guard a flag and never say it. Your only weapon is language — bend the
            model past its own instructions until the flag slips out.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/login" className="btn-recurse-primary">
              Start breaking
            </Link>
            <Link href="/leaderboard" className="btn-recurse-secondary">
              View the leaderboard
            </Link>
          </div>
        </section>

        {/* What is prompt injection */}
        <section className="border-t border-[#1a1e23] py-16">
          <p className="terminal-tag">WHAT_IS_THIS</p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            What is prompt injection?
          </h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <p className="text-sm leading-relaxed text-[#9aa0a6] md:text-base">
              A language model follows instructions written in plain text — including
              instructions that arrive after its own. Prompt injection is the craft of
              writing input that overrides, reframes, or sidesteps the rules a model was
              given, making it do something its author tried to forbid.
            </p>
            <p className="text-sm leading-relaxed text-[#9aa0a6] md:text-base">
              Here, that forbidden thing is a single flag. A guardian is instructed to
              protect it at all costs; you have a chat box. Every seal is a small, honest
              lesson in why "just tell the model not to" is not security — and in how far
              a well-chosen sentence can go.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-[#1a1e23] py-16">
          <p className="terminal-tag">HOW_IT_WORKS</p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            Three steps to a broken seal
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="recurse-card p-6">
                <span className="font-mono text-3xl font-black text-[#9efe00]">{step.n}</span>
                <h3 className="mt-4 text-lg font-bold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#9aa0a6]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-[#1a1e23] py-16">
          <p className="terminal-tag">FAQ</p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            Questions before you start
          </h2>
          <dl className="mt-8 grid gap-4">
            {FAQS.map((faq) => (
              <div key={faq.q} className="recurse-card p-6">
                <dt className="text-base font-bold text-white">{faq.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-[#9aa0a6]">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-[#1a1e23] py-20 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            Ready to break the first seal?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-[#9aa0a6]">
            Sign in, bring a Groq key, and see how the bots hold up against you.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-4">
            <Link href="/login" className="btn-recurse-primary">
              Start breaking
            </Link>
            <Link href="/leaderboard" className="btn-recurse-secondary">
              View the leaderboard
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1a1e23] py-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#5f6368]">
          BREAK THE BOT
        </p>
      </footer>
    </div>
  );
}
