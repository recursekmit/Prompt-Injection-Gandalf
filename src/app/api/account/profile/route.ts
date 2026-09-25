import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readProfile } from "@/lib/validation";

/**
 * Prisma raises P2002 when a unique constraint is violated. Duck-typed rather
 * than `instanceof PrismaClientKnownRequestError` so the check survives error
 * objects that have been wrapped or re-created across module instances — the
 * same approach the signup route uses.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const profile = readProfile(body);
  if (!profile.ok) {
    return Response.json({ error: profile.error }, { status: 400 });
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { name: profile.name, rollNumber: profile.rollNumber },
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return Response.json(
        { error: "That roll number is already registered." },
        { status: 409 },
      );
    }
    console.error("Profile update failed:", error);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
