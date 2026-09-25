import { redirect } from "next/navigation";
import type * as React from "react";

import { GameShell } from "@/components/chat";
import { auth } from "@/lib/auth";
import { readLevelArtwork } from "@/lib/level-artwork";

// The page is a function of the signed-in user, so there is nothing to cache.
export const dynamic = "force-dynamic";

export default async function Home(): Promise<React.JSX.Element> {
  const session = await auth();

  if (session === null) {
    redirect("/login");
  }

  // The current session is deliberately *not* fetched here: the client fetches
  // /api/session/current on mount instead, which keeps this page from issuing a
  // self-request during render and gives the browser one code path for both the
  // first load and every reload.
  //
  // Which backdrops exist is a fact about the filesystem, so it is resolved here
  // and passed down as plain URLs.
  return <GameShell email={session.user?.email ?? ""} artwork={readLevelArtwork()} />;
}
