import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { upsertGithubUser } from "@/lib/auth/oauth";
import { verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { readCredentials } from "@/lib/validation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.authSecret,
  // Local dev is not behind a trusted proxy; without this Auth.js may reject
  // the request host.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = readCredentials(credentials);
        if (!parsed.ok) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.email },
          select: { id: true, email: true, passwordHash: true },
        });

        // A missing user and a wrong password return the same thing, so the
        // response cannot be used to enumerate accounts.
        if (user === null) {
          return null;
        }

        if (user.passwordHash === null) {
          // OAuth-only account: no password to verify against.
          return null;
        }

        const valid = await verifyPassword(parsed.password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return { id: user.id, email: user.email };
      },
    }),
    GitHub({ authorization: { params: { scope: "read:user user:email" } } }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "github") {
        if (typeof user.email !== "string") return false; // no verified email, refuse.
        await upsertGithubUser(user.email);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "github" && typeof token.email === "string") {
        token.id = await upsertGithubUser(token.email);
      } else if (user?.id !== undefined) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
