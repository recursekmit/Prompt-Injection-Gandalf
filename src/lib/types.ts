/**
 * Shared DTOs. Declared once and imported by both the route handlers that
 * produce them and the client components that consume them, so a change to a
 * response shape is a type error at both ends.
 *
 * Nothing here carries the secret word except `revealedWord`, which is present
 * only on a winning attempt. While a session is IN_PROGRESS the client is not
 * told the word: otherwise it sits in the network tab and the game is over.
 */

// Type-only, and deliberately so: `@/lib/guardian/levels` is a server module
// that contains the guardian prompt text, and a type-only import is erased at
// compile time. A client component can therefore import this file without the
// prompt (or any word) being pulled into its bundle. Never turn this into a
// value import.
import type { LevelNumber } from "@/lib/guardian/levels";

export type { LevelNumber };

export type SessionStatus = "IN_PROGRESS" | "WON" | "ABANDONED";

/** Where a player stands on one level, derived from their won sessions. */
export type LevelStatus = "LOCKED" | "CURRENT" | "COMPLETED";

export interface LevelProgressDto {
  level: LevelNumber;
  status: LevelStatus;
  /** The word text, present only once the level has been beaten. */
  revealedWord: string | null;
}

export interface AttemptDto {
  id: string;
  userMessage: string;
  aiResponse: string;
  leaked: boolean;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  level: LevelNumber;
  status: SessionStatus;
  attemptCount: number;
  flagged: boolean;
  startedAt: string;
  endedAt: string | null;
  /** Full history, so a reload or a re-login rebuilds the chat exactly. */
  attempts: AttemptDto[];
  /** Present only once the session is WON. */
  revealedWord: string | null;
}

export interface ProgressResponse {
  levels: LevelProgressDto[];
  /** The lowest unbeaten level, or MAX_LEVEL when every level is beaten. */
  currentLevel: LevelNumber;
  /** The live session, if one is in progress. */
  session: SessionDto | null;
}

/**
 * Level number to public URL of that level's backdrop, present only for the
 * levels that actually have artwork on disk. The mapping is a fact about the
 * filesystem, so the server resolves it and passes plain URLs across the
 * boundary; it is declared here because both ends of that boundary use it.
 */
export type LevelArtwork = Readonly<Partial<Record<LevelNumber, string>>>;

export interface AttemptResponse {
  attempt: AttemptDto;
  attemptCount: number;
  status: SessionStatus;
  /** Present only when this attempt leaked the word. */
  revealedWord: string | null;
}

export interface HistoryEntryDto {
  id: string;
  level: LevelNumber;
  status: SessionStatus;
  wordText: string | null;
  attemptCount: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface HistoryResponse {
  entries: HistoryEntryDto[];
  /** Wins per level over total sessions per level, keyed by level as a string. */
  statsByLevel: Record<string, { won: number; total: number }>;
}

export interface ApiErrorResponse {
  error: string;
}

/* ------------------------------------------------------------------------ *
 * Admin console. Admin-only by construction: these carry every player's
 * email address, so they must never be returned to a non-admin, and the page
 * that renders them must gate before it reads. See lib/admin/require-admin.ts.
 * ------------------------------------------------------------------------ */

/**
 * One player's standings at one level. The per-level breakdown exists because
 * a bare "5/6" tells the operator nothing about where the room is stuck: it is
 * the attempts column that shows level 4 is the wall.
 */
export interface LeaderboardLevelCell {
  level: LevelNumber;
  won: boolean;
  /** Attempts across this player's sessions at this level, won or abandoned. */
  attempts: number;
}

export interface LeaderboardRow {
  /** Position on the board, 1-based. */
  rank: number;
  email: string;
  /** Distinct levels won, 0 to 6. A level won twice is one level. */
  levelsCompleted: number;
  /** Every attempt this player has made, at any level. */
  totalAttempts: number;
  lastWinAt: string | null;
  levels: LeaderboardLevelCell[];
}

export interface LeaderboardLevelSummary {
  level: LevelNumber;
  /** Players who have won it. */
  won: number;
  /** Players who have made at least one attempt at it. */
  attempted: number;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  summary: LeaderboardLevelSummary[];
  /** Players with no attempts, left off the board. */
  playersExcluded: number;
  /** Every account, including those excluded. */
  playersTotal: number;
}

