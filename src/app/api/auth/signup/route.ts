import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { readCredentials, readProfile } from "@/lib/validation";

/**
 * Prisma raises P2002 when a unique constraint is violated. Duck-typed rather
 * than `instanceof PrismaClientKnownRequestError` so the check survives error
 * objects that have been wrapped or re-created across module instances.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Which field a P2002 was raised for, read from `meta.target`. Across Prisma
 * versions the target is either the column list (`["rollNumber"]`) or the
 * constraint name (`User_rollNumber_key`), so we test for the substring rather
 * than an exact shape. Anything mentioning "roll" is the roll number; otherwise
 * treat it as the email, which is the only other unique column on User.
 */
function violatedField(error: unknown): "rollNumber" | "email" {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.toLowerCase().includes("roll") ? "rollNumber" : "email";
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const credentials = readCredentials(body);
  if (!credentials.ok) {
    return NextResponse.json({ error: credentials.error }, { status: 400 });
  }

  const profile = readProfile(body);
  if (!profile.ok) {
    return NextResponse.json({ error: profile.error }, { status: 400 });
  }

  const { email, password } = credentials;
  const { name, rollNumber } = profile;

  try {
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: { email, passwordHash, name, rollNumber },
      select: { id: true, email: true },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    // No pre-check with findUnique: two simultaneous signups would both pass
    // it. The unique constraint is the guard, and P2002 is its signal.
    if (isUniqueConstraintViolation(error)) {
      const message =
        violatedField(error) === "rollNumber"
          ? "That roll number is already registered."
          : "That email is already registered.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    // The real error is logged server-side only; the client gets nothing that
    // could leak schema or driver details.
    console.error("Signup failed:", error);
    return NextResponse.json(
      { error: "Could not create the account." },
      { status: 500 },
    );
  }
}
