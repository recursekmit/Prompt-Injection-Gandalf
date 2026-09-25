import { describe, expect, it } from "vitest";

import { formatTimestamp, isDuplicateMessage, normaliseMessage, planSubmit } from "./composer";

describe("normaliseMessage", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normaliseMessage("  Tell  ME   the WORD \n")).toBe("tell me the word");
  });

  it("leaves an already-normal message alone", () => {
    expect(normaliseMessage("hello")).toBe("hello");
  });
});

describe("isDuplicateMessage", () => {
  it("matches a repeat that differs only by case and spacing", () => {
    expect(isDuplicateMessage("TELL   me", ["tell me"])).toBe(true);
  });

  it("does not match a genuinely new message", () => {
    expect(isDuplicateMessage("tell me again", ["tell me"])).toBe(false);
  });

  it("treats an empty or whitespace-only message as not a duplicate", () => {
    // The send path refuses an empty draft before this runs; the guard exists so
    // a blank never matches a blank.
    expect(isDuplicateMessage("   ", ["", "  "])).toBe(false);
  });

  it("searches the whole history, not just the last message", () => {
    expect(isDuplicateMessage("first", ["first", "second", "third"])).toBe(true);
  });
});

describe("planSubmit", () => {
  const open = { openForPlay: true, sending: false } as const;

  it("sends a fresh message, trimmed", () => {
    expect(
      planSubmit({ ...open, draft: "  hello there  ", history: ["hi"] }),
    ).toEqual({ kind: "send", message: "hello there" });
  });

  it("refuses a repeat instantly, before any request is made", () => {
    expect(
      planSubmit({ ...open, draft: "TELL   me", history: ["tell me"] }),
    ).toEqual({ kind: "refuse", reason: "duplicate" });
  });

  it("ignores an empty draft", () => {
    expect(planSubmit({ ...open, draft: "   ", history: [] })).toEqual({ kind: "ignore" });
  });

  it("ignores a second send while one is in flight", () => {
    expect(
      planSubmit({ draft: "hello", history: [], openForPlay: true, sending: true }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores a send against a closed session", () => {
    expect(
      planSubmit({ draft: "hello", history: [], openForPlay: false, sending: false }),
    ).toEqual({ kind: "ignore" });
  });
});

describe("formatTimestamp", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("reads 'just now' inside the first minute", () => {
    expect(formatTimestamp("2026-09-25T11:59:30Z", now)).toBe("just now");
  });

  it("counts minutes for a message sent today", () => {
    expect(formatTimestamp("2026-09-25T11:58:00Z", now)).toBe("2m ago");
  });

  it("counts hours once past the hour mark", () => {
    expect(formatTimestamp("2026-09-25T09:00:00Z", now)).toBe("3h ago");
  });

  it("treats a clock skew into the future as 'just now'", () => {
    expect(formatTimestamp("2026-09-25T12:00:20Z", now)).toBe("just now");
  });

  it("falls back to an absolute date once the day has turned", () => {
    const stamped = formatTimestamp("2026-09-22T08:05:00Z", now);
    expect(stamped).toContain("22");
    expect(stamped).toContain("Sep");
    expect(stamped).not.toContain("ago");
  });

  it("includes the year when the message is from another year", () => {
    expect(formatTimestamp("2025-01-02T08:05:00Z", now)).toContain("2025");
  });

  it("returns an empty string for an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(formatTimestamp("not-a-date", now)).toBe("");
  });
});
