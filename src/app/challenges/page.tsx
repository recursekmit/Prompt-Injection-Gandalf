import { redirect } from "next/navigation";
import type * as React from "react";

import { GameShell } from "@/components/chat";
import { SiteHeader } from "@/components/site-header";
import { hasGroqKey } from "@/lib/account/groq-key";
import { auth } from "@/lib/auth";
import { readLevelArtwork } from "@/lib/level-artwork";
import { prisma } from "@/lib/prisma";

// The page is a function of the signed-in user, so there is nothing to cache.
export const dynamic = "force-dynamic";

/**
 * The game itself, gated. The order matters: sign in first, then tell us who
 * you are (name + roll number), then hand over a key. Only a player who has
 * cleared all three sees a guardian.
 */
export default async function ChallengesPage(): Promise<React.JSX.Element> {
  const session = await auth();

  if (session === null) {
    redirect("/login");
  }

  const profile = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, rollNumber: true },
  });

  if (!profile?.name || !profile.rollNumber) {
    redirect("/onboarding");
  }

  if (!(await hasGroqKey(session.user.id))) {
    redirect("/settings/key");
  }

  // The current session is deliberately *not* fetched here: the client fetches
  // /api/session/current on mount instead, which keeps this page from issuing a
  // self-request during render and gives the browser one code path for both the
  // first load and every reload.
  return (
    <>
      <SiteHeader />
      <GameShell artwork={readLevelArtwork()} />
    </>
  );
}
