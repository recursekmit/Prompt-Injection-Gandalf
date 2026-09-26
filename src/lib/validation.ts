export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1000;
export const MAX_NAME_LENGTH = 80;

/**
 * College roll number, e.g. `21BD1A0501`: a leading `2`, then any
 * letter-or-digit, `BD`, one more, `A0`, and three more — ten characters, matched
 * against the uppercased input.
 */
export const ROLL_NUMBER_SHAPE = /^2[A-Z0-9]BD[A-Z0-9]A0[A-Z0-9]{3}$/;

export type RollNumberResult =
  | { ok: true; rollNumber: string }
  | { ok: false; error: string };

export type ProfileResult =
  | { ok: true; name: string; rollNumber: string }
  | { ok: false; error: string };

/**
 * Parses a roll number: trimmed and uppercased (so `21bd1a0501` and
 * `21BD1A0501` are the same person), then shape-checked. The uppercased form is
 * what gets stored, so the unique constraint can't be dodged by case.
 */
export function readRollNumber(input: unknown): RollNumberResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Roll number is required." };
  }
  const rollNumber = input.trim().toUpperCase();
  if (rollNumber.length === 0) {
    return { ok: false, error: "Roll number is required." };
  }
  if (!ROLL_NUMBER_SHAPE.test(rollNumber)) {
    return { ok: false, error: "Enter a valid roll number, e.g. 21BD1A0501." };
  }
  return { ok: true, rollNumber };
}

/**
 * The parser shared by the credentials signup route and the onboarding endpoint,
 * so the two collect the same profile. Name is trimmed and length-bounded; the
 * roll number is parsed by `readRollNumber`.
 */
export function readProfile(input: unknown): ProfileResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Name and roll number are required." };
  }

  const { name } = input as { name?: unknown };
  if (typeof name !== "string") {
    return { ok: false, error: "Name is required." };
  }
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, error: "Name is required." };
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }

  const roll = readRollNumber((input as { rollNumber?: unknown }).rollNumber);
  if (!roll.ok) {
    return roll;
  }

  return { ok: true, name: trimmedName, rollNumber: roll.rollNumber };
}

export type CredentialsResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };

/** Deliberately simple: shape check only, as the spec for this form asks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The single parser shared by signup and the credentials provider, so the two
 * can never disagree about what counts as valid credentials.
 *
 * Email is trimmed and lowercased (otherwise one person can hold two accounts);
 * the password is left byte-for-byte as typed, since leading and trailing
 * spaces are legal password characters.
 */
export function readCredentials(input: unknown): CredentialsResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Email and password are required." };
  }

  const { email, password } = input as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string") {
    return { ok: false, error: "Email and password are required." };
  }

  const normalisedEmail = email.trim().toLowerCase();

  if (normalisedEmail.length === 0) {
    return { ok: false, error: "Email is required." };
  }

  if (!EMAIL_SHAPE.test(normalisedEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }

  return { ok: true, email: normalisedEmail, password };
}
