import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  LIMITS,
  countRecentAttempts,
  hasDuplicateAttempt,
} from "@/lib/game/session-service";
import { getGroqKey } from "@/lib/account/groq-key";
import {
  GuardianKeyRateLimitError,
  GuardianUnavailableError,
  callGuardian,
} from "@/lib/guardian/call";
import { buildSystemPrompt, isLevelNumber, levelFor } from "@/lib/guardian/levels";
import { buildMessages, sanitizeUserMessage } from "@/lib/guardian/sanitize";
import { containsFlag } from "@/lib/leak-detection";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const GUARDIAN_OVERWHELMED = "The guardian is overwhelmed. Wait a moment and try again.";

/**
 * How many earlier attempts are replayed to the model. The deepest win chain
 * the levels were tuned against is three turns, so this never truncates a
 * scenario a level was tuned for, and it bounds what one call can cost in
 * tokens — which is the pool's real ceiling.
 */
const HISTORY_ATTEMPTS = 20;

/**
 * Submit one message to the guardian.
 *
 * The order of operations below is security-relevant, not stylistic:
 *   1. authenticate, and confirm the session belongs to the caller
 *   2. refuse anything not IN_PROGRESS, so a won session cannot be replayed
 *   3. reject a message that has already been sent in this session, BEFORE the
 *      throttle: detecting a duplicate is free, so it must not spend the
 *      player's rate budget or a unit of quota. The client checks too, for
 *      instant feedback, but the client is the attacker's to modify, so only
 *      this check decides
 *   4. throttle, and flag sessions that look automated
 *   5. sanitise the message and rebuild the system prompt FROM THE CONSTANT —
 *      never from anything stored or influenced by the conversation
 *   6. call the model and read `content` only (see guardian/call.ts)
 *   7. scan that content for the flag — only to record `leaked` on the row as a
 *      hint; a leak no longer wins the level (the flag route does)
 *   8. write the attempt in one transaction, flagging the session if the pace
 *      looks automated
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
      flag: { select: { value: true } },
      word: { select: { text: true } },
      attempts: { orderBy: { createdAt: "asc" } },
    },
  });

  // 404 rather than 403: a 403 would confirm that somebody else's session exists.
  if (gameSession === null) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  // The per-user flag this session guards, with a legacy word fallback for
  // historic rows. A session with neither is corrupt data, not a playable game.
  const flagValue = gameSession.flag?.value ?? gameSession.word?.text ?? null;
  if (flagValue === null) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  // The column is a plain integer. Every session is created from a level that
  // was validated at start, so a row outside 1-3 is corrupt data rather than a
  // player mistake, and there is no prompt to build for it.
  const level = gameSession.level;
  if (!isLevelNumber(level)) {
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

  if (await hasDuplicateAttempt(gameSession.id, message)) {
    return NextResponse.json(
      { error: "You have already tried that exact message." },
      { status: 409 },
    );
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

  const apiKey = await getGroqKey(session.user.id);
  if (apiKey === null) {
    return NextResponse.json(
      { error: "Add your Groq API key in settings before playing." },
      { status: 400 },
    );
  }

  // Rebuilt on every request from the trusted secret (persona + seal from the
  // validated env). The template is never stored, never mutated, and never
  // interpolates anything from the request beyond the level's own word.
  const secret = env.guardianLevels.get(level);
  if (secret === undefined) {
    return NextResponse.json({ error: "The guardian is unavailable right now." }, { status: 503 });
  }
  const systemPrompt = buildSystemPrompt(secret, flagValue);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...buildMessages(gameSession.attempts.slice(-HISTORY_ATTEMPTS), message),
  ];

  let reply: string;
  try {
    reply = await callGuardian(messages, levelFor(level).effort, apiKey);
  } catch (error: unknown) {
    if (error instanceof GuardianKeyRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof GuardianUnavailableError) {
      return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
    }
    console.error("guardian call failed", error);
    return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
  }

  // The leak scan still runs on every reply, but it no longer wins the level:
  // it only records whether this reply contained the real flag, so the
  // transcript can flag it as a hint. Winning happens only when the player
  // submits the flag to the flag route.
  const scan = containsFlag(reply, flagValue);

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
      data: looksAutomated ? { flagged: true } : {},
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
  });
}

export const dynamic = "force-dynamic";
// The guardian call runs ~14s p50; 60s is the Vercel Hobby ceiling and leaves margin.
export const maxDuration = 60;
