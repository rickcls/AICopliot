import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateResetToken,
  hashResetToken,
  passwordResetEmail,
  RESET_COOLDOWN_MS,
  RESET_TTL_MS,
  resetExpiry,
} from "@/lib/auth/password-reset";

const NOW = new Date("2026-10-22T06:00:00Z");

describe("reset tokens", () => {
  it("are 32 random bytes in base64url, different every time", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hash deterministically, and the hash is not the token", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(token)).not.toContain(token);
  });

  it("expire after one hour", () => {
    expect(resetExpiry(NOW).getTime() - NOW.getTime()).toBe(RESET_TTL_MS);
  });
});

describe("passwordResetEmail", () => {
  it("writes Traditional Chinese for a zh-Hant account and English for en", () => {
    const zh = passwordResetEmail({
      to: "ada@example.com",
      resetUrl: "https://app.example/reset-password/tok",
      locale: "zh-Hant",
      appName: "ScopePilot",
    });
    const en = passwordResetEmail({
      to: "ada@example.com",
      resetUrl: "https://app.example/reset-password/tok",
      locale: "en",
      appName: "ScopePilot",
    });
    expect(zh.subject).toBe("重設 ScopePilot 密碼");
    expect(en.subject).toBe("Reset your ScopePilot password");
  });

  it("escapes the link in html", () => {
    const message = passwordResetEmail({
      to: "ada@example.com",
      resetUrl: `https://app.example/reset-password/a<b>&"c"`,
      locale: "en",
      appName: "ScopePilot",
    });
    expect(message.html).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(message.html).not.toContain("<b>");
  });
});

const tx = {
  passwordReset: {
    updateMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  user: { update: vi.fn() },
};

const mockPrisma = {
  user: { findUnique: vi.fn() },
  passwordReset: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (client: typeof tx) => unknown)(tx) : arg,
  ),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));

const { requestPasswordReset, resetPassword } = await import(
  "@/lib/auth/password-reset-service"
);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.passwordReset.findFirst.mockResolvedValue(null);
  mockPrisma.passwordReset.updateMany.mockResolvedValue({ count: 1 });
  tx.passwordReset.updateMany.mockResolvedValue({ count: 1 });
  tx.passwordReset.create.mockResolvedValue({ id: "reset-1" });
  tx.passwordReset.findFirst.mockResolvedValue({ userId: "user-1" });
  tx.user.update.mockResolvedValue({ id: "user-1" });
});

describe("requestPasswordReset", () => {
  it("does not send when the address has no account", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const sender = vi.fn();
    await requestPasswordReset({
      email: "missing@example.com",
      origin: "https://app.example",
      sender,
      now: NOW,
    });
    expect(sender).not.toHaveBeenCalled();
  });

  it("stores only the hash and emails the raw token once", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      locale: "en",
    });
    const sent: { text: string }[] = [];
    await requestPasswordReset({
      email: "ADA@example.com",
      origin: "https://app.example/",
      sender: async (message) => {
        sent.push(message);
      },
      now: NOW,
    });
    const token = sent[0]?.text.match(/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const created = tx.passwordReset.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(hashResetToken(token!));
    expect(JSON.stringify(created)).not.toContain(token);
  });

  it("does not send a second message inside the cooldown", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      locale: "zh-Hant",
    });
    mockPrisma.passwordReset.findFirst.mockResolvedValue({ id: "recent" });
    const sender = vi.fn();
    await requestPasswordReset({
      email: "ada@example.com",
      origin: "https://app.example",
      sender,
      now: NOW,
    });
    expect(sender).not.toHaveBeenCalled();
    expect(mockPrisma.passwordReset.findFirst.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      createdAt: { gt: new Date(NOW.getTime() - RESET_COOLDOWN_MS) },
    });
  });
});

describe("resetPassword", () => {
  it("changes nothing when the link was already used", async () => {
    tx.passwordReset.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await resetPassword("raw-token-value-1234567890", "new-password", NOW)).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
