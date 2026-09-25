import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-[#050607] px-6 py-16">
      <div className="recurse-card w-full max-w-sm p-8">{children}</div>
    </main>
  );
}
