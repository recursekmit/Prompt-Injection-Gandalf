import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-stone-950 px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl shadow-black/40">
        {children}
      </div>
    </main>
  );
}
