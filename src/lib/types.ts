/**
 * Shared DTOs. Declared once and imported by both the route handlers that
 * produce them and the client components that consume them, so a change to a
 * response shape is a type error at both ends.
 *
 * Nothing here carries the secret word except `revealedWord`, which is present
 * only on a winning attempt. While a session is IN_PROGRESS the client is not
 * told the word: otherwise it sits in the network tab and the game is over.
 */

export type Tier = "APPRENTICE" | "ADEPT" | "ARCHMAGE";

export type SessionStatus = "IN_PROGRESS" | "WON" | "ABANDONED";

export const TIERS: readonly Tier[] = ["APPRENTICE", "ADEPT", "ARCHMAGE"];

export interface AttemptDto {
  id: string;
  userMessage: string;
  aiResponse: string;
  leaked: boolean;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  tier: Tier;
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

export interface CurrentSessionResponse {
  session: SessionDto | null;
}

export interface AttemptResponse {
  attempt: AttemptDto;
  attemptCount: number;
  status: SessionStatus;
  /** Present only when this attempt leaked the word. */
  revealedWord: string | null;
}

export interface HistoryEntryDto {
  id: string;
  tier: Tier;
  status: SessionStatus;
  wordText: string | null;
  attemptCount: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface HistoryResponse {
  entries: HistoryEntryDto[];
  /** Wins per tier over total sessions per tier. */
  stats: Record<Tier, { won: number; total: number }>;
}

export interface ApiErrorResponse {
  error: string;
}
