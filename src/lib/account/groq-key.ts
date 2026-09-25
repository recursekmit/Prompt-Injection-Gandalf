import Groq from "groq-sdk";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Checks a key with Groq itself: a `models.list()` call is cheap (no tokens
 * spent) and 401s on a bad key, which is exactly the yes/no we need. Any error
 * means "do not accept it".
 */
export async function validateGroqKey(apiKey: string): Promise<boolean> {
  try {
    await new Groq({ apiKey }).models.list();
    return true;
  } catch {
    return false;
  }
}

export async function storeGroqKey(userId: string, apiKey: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { groqKeyEnc: encryptSecret(apiKey, env.keyEncryptionKey) },
  });
}

export async function clearGroqKey(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { groqKeyEnc: null } });
}

export async function getGroqKey(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { groqKeyEnc: true } });
  if (row?.groqKeyEnc == null) return null;
  return decryptSecret(row.groqKeyEnc, env.keyEncryptionKey);
}

export async function hasGroqKey(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { groqKeyEnc: true } });
  return row?.groqKeyEnc != null;
}
