import bcrypt from "bcryptjs";

/**
 * Default work factor. 12 is the current sane default for a server that can
 * afford ~250ms per hash; tests inject 4 so the suite stays fast.
 */
export const BCRYPT_COST = 12;

export async function hashPassword(
  plain: string,
  cost: number = BCRYPT_COST,
): Promise<string> {
  return bcrypt.hash(plain, cost);
}

/**
 * Never throws: a malformed or truncated hash resolves to false so callers can
 * treat "unusable stored hash" and "wrong password" identically.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
