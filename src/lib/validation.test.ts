import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  readCredentials,
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
