import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { LIMITS, countRecentAttempts } from "@/lib/game/session-service";
import { GuardianUnavailableError, callGuardian } from "@/lib/guardian/call";
import { buildSystemPrompt } from "@/lib/guardian/prompt";
import { buildMessages, sanitizeUserMessage } from "@/lib/guardian/sanitize";
import { GuardianBusyError } from "@/lib/groq-key-pool";
import { containsSecret } from "@/lib/leak-detection";
import { prisma } from "@/lib/prisma";

const GUARDIAN_OVERWHELMED = "The guardian is overwhelmed. Wait a moment and try again.";

/**
 * Submit one message to the guardian.
 *
 * The order of operations below is security-relevant, not stylistic:
 *   1. authenticate, and confirm the session belongs to the caller
 *   2. refuse anything not IN_PROGRESS, so a won session cannot be replayed
 *   3. throttle, and flag sessions that look automated
 *   4. sanitise the message and rebuild the system prompt FROM THE CONSTANT —
 *      never from anything stored or influenced by the conversation
 *   5. call the model and read `content` only (see guardian/call.ts)
 *   6. scan that content for the word BEFORE it reaches the client
 *   7. write the attempt and, on a leak, mark the session won — in one transaction
 *
 * A failed model call writes no Attempt row. A failure is not an attempt, and
 * logging it as one would corrupt both the counters and any future leaderboard.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  const gameSession = await prisma.gameSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      word: { select: { text: true } },
      attempts: { orderBy: { createdAt: "asc" } },
    },
  });

  // 404 rather than 403: a 403 would confirm that somebody else's session exists.
  if (gameSession === null) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  if (gameSession.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "That session is already finished." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const raw = (body as { message?: unknown } | null)?.message;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const message = sanitizeUserMessage(raw);
  if (message.trim().length === 0) {
    return NextResponse.json({ error: "That message was empty." }, { status: 400 });
  }

  const recentMinute = await countRecentAttempts(
    gameSession.id,
    LIMITS.throttleWindowMs,
  );
  if (recentMinute > LIMITS.throttleAttemptsPerMinute) {
    return NextResponse.json(
      { error: "Slow down — the guardian needs a moment between questions." },
      { status: 429 },
    );
  }

  // Rebuilt on every request from the trusted constant. The template is never
  // stored, never mutated, and never interpolates anything from the request.
  const systemPrompt = buildSystemPrompt(gameSession.word.text, gameSession.tier);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...buildMessages(gameSession.attempts, message),
  ];

  let reply: string;
  try {
    reply = await callGuardian(messages, gameSession.tier);
  } catch (error: unknown) {
    if (error instanceof GuardianBusyError) {
      return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
    }
    if (error instanceof GuardianUnavailableError) {
      return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
    }
    console.error("guardian call failed", error);
    return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
  }

  // The backstop. Runs on every response, on every path, without exception.
  const scan = containsSecret(reply, gameSession.word.text);

  const fiveMinutesAgo = new Date(Date.now() - LIMITS.flagWindowMs);
  const recentFiveMinutes = await prisma.attempt.count({
    where: { sessionId: gameSession.id, createdAt: { gt: fiveMinutesAgo } },
  });
  const looksAutomated = recentFiveMinutes + 1 > LIMITS.flagAttemptsPerFiveMinutes;

  const [attempt] = await prisma.$transaction([
    prisma.attempt.create({
      data: {
        sessionId: gameSession.id,
        userMessage: raw,
        aiResponse: reply,
        leaked: scan.leaked,
      },
    }),
    prisma.gameSession.update({
      where: { id: gameSession.id },
      data: {
        ...(scan.leaked ? { status: "WON" as const, endedAt: new Date() } : {}),
        ...(looksAutomated ? { flagged: true } : {}),
      },
    }),
  ]);

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      userMessage: attempt.userMessage,
      aiResponse: attempt.aiResponse,
      leaked: attempt.leaked,
      createdAt: attempt.createdAt.toISOString(),
    },
    attemptCount: gameSession.attempts.length + 1,
    status: scan.leaked ? "WON" : "IN_PROGRESS",
    revealedWord: scan.leaked ? gameSession.word.text : null,
  });
}

export const dynamic = "force-dynamic";
