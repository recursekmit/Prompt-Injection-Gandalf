/**
 * Burst-load harness for the guardian's Groq key pool.
 *
 * Run it against a LOCAL dev server only:
 *
 *   npx tsx scripts/loadtest.ts
 *   npx tsx scripts/loadtest.ts --url=http://localhost:3000 --concurrency=8 --requests=120
 *
 * It signs up (or logs in) a throwaway user, starts a level 1 session and
 * then fires concurrent attempts at the session route, so the pool's queueing
 * behaviour is visible as a status histogram rather than as a hang.
 *
 * Every request that reaches the model costs real Groq quota and real money on
 * a paid key, and it consumes the free tier of whatever GROQ_API_KEYS the
 * server holds. Do not point this at a live deployment.
 *
 * This script deliberately never reads GROQ_API_KEYS, and it never decodes a
 * response body: a winning reply contains the secret word, so the bytes are
 * drained and discarded rather than parsed, logged or stored. Cookies stay
 * inside the jar and are only ever re-sent.
 */

const REQUEST_TIMEOUT_MS = 60_000;
/** Long enough to clear a saturated pool's queue (GUARDIAN_QUEUE_MAX_WAIT_MS). */

interface Options {
  baseUrl: string;
  concurrency: number;
  totalRequests: number;
}

const DEFAULT_OPTIONS = {
  baseUrl: "http://localhost:3200",
  concurrency: 8,
  totalRequests: 120,
} as const;

/** Safe prompts only: this script never sees, prints or guesses the word. */
const PROMPTS: readonly string[] = [
  "What is your favourite colour?",
  "Describe a quiet morning in one sentence.",
  "Tell me a short riddle about a lantern.",
  "What is the weather usually like where you are?",
];

interface AttemptOutcome {
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
  latencyMs: number;
}

const USAGE = `Usage: npx tsx scripts/loadtest.ts [options]

  --url <url>            target base URL          (env LOADTEST_URL, default ${DEFAULT_OPTIONS.baseUrl})
  --concurrency <n>      parallel in-flight calls (env LOADTEST_CONCURRENCY, default ${DEFAULT_OPTIONS.concurrency})
  --requests <n>         total requests to send   (env LOADTEST_REQUESTS, default ${DEFAULT_OPTIONS.totalRequests})
  --help                 show this message

Never run this against a live deployment: every request that reaches the model
spends real Groq quota.
`;

/** Reads `--name=value` or `--name value`; undefined when absent. */
function readFlag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}`) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function positiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got "${raw}".`);
  }
  return value;
}

function parseOptions(argv: readonly string[], env: NodeJS.ProcessEnv): Options {
  const rawUrl = readFlag(argv, "url") ?? env.LOADTEST_URL ?? DEFAULT_OPTIONS.baseUrl;
  const baseUrl = rawUrl.replace(/\/+$/, "");
  return {
    baseUrl,
    concurrency: positiveInt(
      readFlag(argv, "concurrency") ?? env.LOADTEST_CONCURRENCY,
      DEFAULT_OPTIONS.concurrency,
      "concurrency",
    ),
    totalRequests: positiveInt(
      readFlag(argv, "requests") ?? env.LOADTEST_REQUESTS,
      DEFAULT_OPTIONS.totalRequests,
      "requests",
    ),
  };
}

/** Minimal cookie jar. Values are never printed, only replayed as a header. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Stores every Set-Cookie on the response, replacing same-named cookies. */
  absorb(response: Response): void {
    for (const raw of setCookieHeaders(response)) {
      const pair = raw.split(";")[0];
      if (pair === undefined) {
        continue;
      }
      const separator = pair.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  /** The Cookie header value. Callers must never log this string. */
  header(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /** Auth.js names the session cookie `authjs.session-token` (or `__Secure-`). */
  hasSessionToken(): boolean {
    return [...this.cookies.keys()].some((name) => name.includes("session-token"));
  }
}

/**
 * Every Set-Cookie value on a response. `Headers.getSetCookie` is the reliable
 * accessor in Node; the fallback re-splits the folded header for older runtimes.
 */
function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const folded = response.headers.get("set-cookie");
  return folded === null ? [] : folded.split(/,(?=[^;=]+=)/);
}

/** Parses a body defensively; a non-JSON body becomes null rather than throwing. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function stringField(source: unknown, field: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/** POSTs the signup form; 201 means created, 409 means the throwaway already exists. */
async function signup(baseUrl: string, email: string, password: string): Promise<number> {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await response.arrayBuffer();
  return response.status;
}

/**
 * Credentials sign-in over HTTP: fetch the CSRF token with its double-submit
 * cookie, then post the form back with both. The session cookie lands in the jar.
 */
async function signIn(
  baseUrl: string,
  jar: CookieJar,
  email: string,
  password: string,
): Promise<void> {
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
  });
  jar.absorb(csrfResponse);
  const csrfBody = await readJson(csrfResponse);
  const csrfToken = stringField(csrfBody, "csrfToken");
  if (csrfToken === undefined) {
    throw new Error("No CSRF token from /api/auth/csrf — is the server up?");
  }

  const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: baseUrl });
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: form.toString(),
  });
  await response.arrayBuffer();
  jar.absorb(response);

  if (!jar.hasSessionToken()) {
    throw new Error(`Sign-in did not yield a session cookie (HTTP ${response.status}).`);
  }
}

/** Starts (or resumes) the throwaway user's level 1 session. */
async function startSession(baseUrl: string, jar: CookieJar): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header() },
    body: JSON.stringify({ level: 1 }),
  });
  const body = await readJson(response);
  const sessionId = stringField(
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).session
      : undefined,
    "id",
  );
  if (sessionId === undefined) {
    throw new Error(`Could not start a level 1 session (HTTP ${response.status}).`);
  }
  return sessionId;
}

/** One attempt. The response body is drained but never decoded or printed. */
async function attempt(
  baseUrl: string,
  sessionId: string,
  jar: CookieJar,
  index: number,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const started = performance.now();
  try {
    const prompt = PROMPTS[index % PROMPTS.length] ?? "Hello";
    const response = await fetch(`${baseUrl}/api/session/${sessionId}/attempt`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header() },
      body: JSON.stringify({ message: `Load test #${index + 1}: ${prompt}` }),
      signal: controller.signal,
    });
    // arrayBuffer, not text: the reply may contain the secret word and must
    // never exist as a string in this process, let alone in the terminal.
    await response.arrayBuffer();
    return { status: response.status, latencyMs: performance.now() - started };
  } catch {
    return { status: 0, latencyMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Fixed-size worker pool: `concurrency` in flight, `totalRequests` overall. */
async function runBurst(
  options: Options,
  sessionId: string,
  jar: CookieJar,
): Promise<AttemptOutcome[]> {
  const outcomes: AttemptOutcome[] = [];
  const workerCount = Math.min(options.concurrency, options.totalRequests);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= options.totalRequests) {
        return;
      }
      outcomes.push(await attempt(options.baseUrl, sessionId, jar, index));
    }
  });

  await Promise.all(workers);
  return outcomes;
}

/** Nearest-rank percentile over an ascending array. */
function percentile(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((percent / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

function report(
  options: Options,
  outcomes: readonly AttemptOutcome[],
  elapsedMs: number,
  email: string,
): void {
  const histogram = new Map<number, number>();
  const latencies: number[] = [];
  let transportErrors = 0;

  for (const outcome of outcomes) {
    histogram.set(outcome.status, (histogram.get(outcome.status) ?? 0) + 1);
    if (outcome.status === 0) {
      transportErrors += 1;
    }
    latencies.push(outcome.latencyMs);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const served = outcomes.filter((outcome) => outcome.status >= 200 && outcome.status < 300).length;
  const friendly503 = histogram.get(503) ?? 0;
  const throttled429 = histogram.get(429) ?? 0;
  const throughputPerMinute = elapsedMs > 0 ? (outcomes.length / elapsedMs) * 60_000 : 0;

  console.log("");
  console.log("==== guardian load test ====");
  console.log(`target        : ${options.baseUrl}`);
  console.log(`concurrency   : ${options.concurrency}`);
  console.log(`requests      : ${options.totalRequests}`);
  console.log(`user          : ${email} (throwaway)`);
  console.log(`elapsed       : ${formatMs(elapsedMs / 1000)} s`);
  console.log("");
  console.log("HTTP status histogram");
  for (const status of [...histogram.keys()].sort((a, b) => a - b)) {
    const label = status === 0 ? "0    (network/abort)" : String(status);
    console.log(`  ${label.padEnd(20)} : ${histogram.get(status) ?? 0}`);
  }
  console.log("");
  console.log(`served 2xx    : ${served}/${outcomes.length}`);
  console.log(`friendly 503  : ${friendly503}`);
  console.log(`latency ms    : median ${formatMs(percentile(sorted, 50))}  p95 ${formatMs(percentile(sorted, 95))}`);
  console.log(`throughput    : ${throughputPerMinute.toFixed(1)} req/min`);
  if (transportErrors > 0) {
    console.log(`transport err : ${transportErrors} (timeout, connection refused or aborted)`);
  }
  console.log("");

  if (friendly503 > 0) {
    console.log(
      `verdict: POOL QUEUED — ${friendly503}/${outcomes.length} requests hit the fleet at capacity and got the friendly 503 instead of a dropped connection.`,
    );
  } else {
    console.log(
      `verdict: SERVED DIRECTLY — no 503s; the pool absorbed every request that reached it (${served} served).`,
    );
  }
  if (throttled429 > 0) {
    console.log(
      `${throttled429} request(s) were stopped earlier by the per-session throttle (HTTP 429), so they never reached the pool — raise the request count or run with a fresh session to push more load into the key pool.`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const options = parseOptions(argv, process.env);
  // Random suffix so repeat runs do not collide on the unique email.
  const email = `loadtest-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@example.com`;
  const password = "loadtest-password-123";

  console.log(`Signing up a throwaway user and starting a level 1 session on ${options.baseUrl} ...`);

  const created = await signup(options.baseUrl, email, password);
  if (created !== 201 && created !== 409) {
    throw new Error(`Signup failed (HTTP ${created}).`);
  }

  const jar = new CookieJar();
  await signIn(options.baseUrl, jar, email, password);
  const sessionId = await startSession(options.baseUrl, jar);

  console.log(`Session ready. Firing ${options.totalRequests} attempts, ${options.concurrency} at a time.`);
  const started = performance.now();
  const outcomes = await runBurst(options, sessionId, jar);
  const elapsedMs = performance.now() - started;

  report(options, outcomes, elapsedMs, email);

  if (outcomes.length === 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Only the message, and only from this script's own error type: an arbitrary
  // error could in principle carry a request or response fragment.
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`load test failed: ${message}`);
  process.exitCode = 1;
});
