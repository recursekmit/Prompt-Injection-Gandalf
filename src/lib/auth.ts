import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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

        const valid = await verifyPassword(parsed.password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id !== undefined) {
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
