import { prisma } from "@/lib/prisma";

/**
 * Ensures a User row exists for a GitHub sign-in and returns its DB id. The
 * email is the join key: a player who signed up with a password and later uses
 * GitHub with the same verified email lands on the same account.
 */
export async function upsertGithubUser(email: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return user.id;
}
