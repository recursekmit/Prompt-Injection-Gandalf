import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/auth/password";

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn<
    (args: {
      data: {
        email: string;
        passwordHash: string;
        name: string;
        rollNumber: string;
      };
    }) => Promise<{ id: string; email: string }>
  >(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { create: createMock } },
}));

import { POST } from "./route";

const PASSWORD = "correct horse battery staple";
const PROFILE = { name: "Ada Lovelace", rollNumber: "21BD1A0501" };

function post(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

function postJson(value: unknown): Request {
  return post(JSON.stringify(value));
}

function firstCreateArg(): {
  data: {
    email: string;
    passwordHash: string;
    name: string;
    rollNumber: string;
  };
} {
  const call = createMock.mock.calls[0];
  if (call === undefined) {
    throw new Error("prisma.user.create was never called");
  }
  return call[0];
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("creates the account and returns 201 with the selected fields", async () => {
    createMock.mockResolvedValue({ id: "user_1", email: "ada@example.com" });

    const response = await POST(
      postJson({ email: "  Ada@Example.com ", password: PASSWORD, ...PROFILE }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "user_1",
      email: "ada@example.com",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    // The email reaches the database normalised, not as typed.
    expect(firstCreateArg().data.email).toBe("ada@example.com");
    // Name and the uppercased roll number are persisted alongside it.
    expect(firstCreateArg().data.name).toBe("Ada Lovelace");
    expect(firstCreateArg().data.rollNumber).toBe("21BD1A0501");
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    createMock.mockResolvedValue({ id: "user_1", email: "ada@example.com" });

    await POST(postJson({ email: "ada@example.com", password: PASSWORD, ...PROFILE }));

    const { passwordHash } = firstCreateArg().data;
    expect(passwordHash).not.toBe(PASSWORD);
    expect(passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    await expect(verifyPassword(PASSWORD, passwordHash)).resolves.toBe(true);
  });

  it("returns 400 on a short password without touching the database", async () => {
    const response = await POST(
      postJson({ email: "ada@example.com", password: "short", ...PROFILE }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("8");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed email without touching the database", async () => {
    const response = await POST(
      postJson({ email: "not-an-email", password: PASSWORD, ...PROFILE }),
    );

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name or roll number is missing", async () => {
    const noName = await POST(
      postJson({ email: "ada@example.com", password: PASSWORD, rollNumber: "21BD1A0501" }),
    );
    expect(noName.status).toBe(400);

    const badRoll = await POST(
      postJson({ email: "ada@example.com", password: PASSWORD, name: "Ada", rollNumber: "nope" }),
    );
    expect(badRoll.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400, not 500, on a non-JSON body", async () => {
    const response = await POST(post("this is not json"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTypeOf("string");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already registered", async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["email"] },
      }),
    );

    const response = await POST(
      postJson({ email: "ada@example.com", password: PASSWORD, ...PROFILE }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That email is already registered.",
    });
  });

  it("returns 409 naming the roll number when that is what collides", async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: "User_rollNumber_key" },
      }),
    );

    const response = await POST(
      postJson({ email: "ada@example.com", password: PASSWORD, ...PROFILE }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That roll number is already registered.",
    });
  });

  it("returns 500 without leaking the internal error message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      createMock.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      );

      const response = await POST(
        postJson({ email: "ada@example.com", password: PASSWORD, ...PROFILE }),
      );

      expect(response.status).toBe(500);
      const raw = await response.text();
      expect(raw).not.toContain("ECONNREFUSED");
      expect(JSON.parse(raw)).toEqual({ error: "Could not create the account." });
      // The real error is still logged server-side.
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
