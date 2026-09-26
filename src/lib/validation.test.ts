import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  readCredentials,
  readProfile,
  readRollNumber,
} from "./validation";

const PASSWORD = "correct horse battery staple";

describe("readCredentials", () => {
  it("accepts a well-formed pair", () => {
    expect(readCredentials({ email: "ada@example.com", password: PASSWORD })).toEqual({
      ok: true,
      email: "ada@example.com",
      password: PASSWORD,
    });
  });

  it("trims and lowercases the email", () => {
    const result = readCredentials({
      email: "  Ada@Example.COM  ",
      password: PASSWORD,
    });
    expect(result).toEqual({ ok: true, email: "ada@example.com", password: PASSWORD });
  });

  it("preserves the password verbatim, including surrounding spaces", () => {
    const password = "  spaces are legal  ";
    const result = readCredentials({ email: "ada@example.com", password });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.password).toBe(password);
    }
  });

  it("rejects non-object input", () => {
    expect(readCredentials(null).ok).toBe(false);
    expect(readCredentials(undefined).ok).toBe(false);
    expect(readCredentials("ada@example.com").ok).toBe(false);
    expect(readCredentials(42).ok).toBe(false);
    expect(readCredentials([]).ok).toBe(false);
  });

  it("rejects non-string fields", () => {
    expect(readCredentials({ email: 1, password: PASSWORD }).ok).toBe(false);
    expect(readCredentials({ email: "ada@example.com", password: 1 }).ok).toBe(false);
    expect(readCredentials({ email: "ada@example.com" }).ok).toBe(false);
    expect(readCredentials({ password: PASSWORD }).ok).toBe(false);
  });

  it("rejects an empty or whitespace-only email", () => {
    expect(readCredentials({ email: "", password: PASSWORD }).ok).toBe(false);
    expect(readCredentials({ email: "   ", password: PASSWORD }).ok).toBe(false);
  });

  it("rejects an email missing @ or a dot", () => {
    expect(readCredentials({ email: "adaexample.com", password: PASSWORD }).ok).toBe(
      false,
    );
    expect(readCredentials({ email: "ada@example", password: PASSWORD }).ok).toBe(
      false,
    );
    expect(readCredentials({ email: "ada@example.", password: PASSWORD }).ok).toBe(
      false,
    );
    expect(readCredentials({ email: "@example.com", password: PASSWORD }).ok).toBe(
      false,
    );
  });

  it("rejects a password one below the minimum, naming the number", () => {
    const result = readCredentials({
      email: "ada@example.com",
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(MIN_PASSWORD_LENGTH));
    }
  });

  it("accepts a password exactly at the minimum", () => {
    expect(
      readCredentials({
        email: "ada@example.com",
        password: "a".repeat(MIN_PASSWORD_LENGTH),
      }).ok,
    ).toBe(true);
  });

  it("rejects a password over the maximum", () => {
    const result = readCredentials({
      email: "ada@example.com",
      password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(MAX_PASSWORD_LENGTH));
    }
  });
});

describe("readRollNumber", () => {
  it("accepts a well-formed roll number", () => {
    expect(readRollNumber("21BD1A0501")).toEqual({ ok: true, rollNumber: "21BD1A0501" });
  });

  it("trims and uppercases", () => {
    expect(readRollNumber("  21bd1a0501  ")).toEqual({
      ok: true,
      rollNumber: "21BD1A0501",
    });
  });

  it("accepts letters where the pattern allows them", () => {
    expect(readRollNumber("2XBDYA0ZAB").ok).toBe(true);
  });

  it("rejects the wrong shape", () => {
    expect(readRollNumber("").ok).toBe(false);
    expect(readRollNumber("31BD1A0501").ok).toBe(false); // must start with 2
    expect(readRollNumber("21XX1A0501").ok).toBe(false); // BD fixed
    expect(readRollNumber("21BD1B0501").ok).toBe(false); // A0 fixed
    expect(readRollNumber("21BD1A050").ok).toBe(false); // too short
    expect(readRollNumber("21BD1A05012").ok).toBe(false); // too long
    expect(readRollNumber("21BD1A05@1").ok).toBe(false); // non-alphanumeric
  });

  it("rejects non-string input", () => {
    expect(readRollNumber(undefined).ok).toBe(false);
    expect(readRollNumber(21).ok).toBe(false);
    expect(readRollNumber(null).ok).toBe(false);
  });
});

describe("readProfile", () => {
  it("accepts a name and roll number, trimming the name", () => {
    expect(readProfile({ name: "  Ada Lovelace  ", rollNumber: "21bd1a0501" })).toEqual({
      ok: true,
      name: "Ada Lovelace",
      rollNumber: "21BD1A0501",
    });
  });

  it("rejects a missing or empty name", () => {
    expect(readProfile({ rollNumber: "21BD1A0501" }).ok).toBe(false);
    expect(readProfile({ name: "   ", rollNumber: "21BD1A0501" }).ok).toBe(false);
    expect(readProfile({ name: 42, rollNumber: "21BD1A0501" }).ok).toBe(false);
  });

  it("rejects a name over the maximum", () => {
    const result = readProfile({
      name: "a".repeat(MAX_NAME_LENGTH + 1),
      rollNumber: "21BD1A0501",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(MAX_NAME_LENGTH));
    }
  });

  it("rejects an invalid roll number", () => {
    expect(readProfile({ name: "Ada", rollNumber: "nope" }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(readProfile(null).ok).toBe(false);
    expect(readProfile("Ada").ok).toBe(false);
  });
});
