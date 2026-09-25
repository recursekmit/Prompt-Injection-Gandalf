import { redirect } from "next/navigation";
import type * as React from "react";

import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, rollNumber: true },
  });

  if (user?.name && user.rollNumber) {
    redirect("/challenges");
  }

  const defaultName = user?.name ?? session.user.name ?? "";

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center px-6 py-12">
        <div className="recurse-card w-full max-w-md">
          <div className="flex flex-col gap-2">
            <span className="terminal-tag">IDENTIFY YOURSELF</span>
            <h1 className="font-sans text-2xl font-extrabold text-white">
              Before you enter
            </h1>
            <p className="font-sans text-sm text-[#9aa0a6]">
              The archive records who broke each seal. Tell us who you are.
            </p>
          </div>
          <div className="mt-6">
            <OnboardingForm defaultName={defaultName} />
          </div>
        </div>
      </main>
    </>
  );
}
