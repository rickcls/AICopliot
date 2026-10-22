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
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
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
    expect(zh.text).toContain("https://app.example/reset-password/tok");
    expect(zh.text).toContain("一小時");
    expect(en.subject).toBe("Reset your ScopePilot password");
    expect(en.text).toContain("one hour");
  });

  it("falls back to Traditional Chinese for an unknown locale", () => {
    const message = passwordResetEmail({
      to: "ada@example.com",
      resetUrl: "https://app.example/reset-password/tok",
      locale: "zh-CN",
      appName: "ScopePilot",
    });
    expect(message.subject).toContain("重設");
  });

  it("escapes the link in html and leaves it plain in the text", () => {
    const message = passwordResetEmail({
      to: "ada@example.com",
      resetUrl: `https://app.example/reset-password/a<b>&"c"`,
      locale: "en",
      appName: "ScopePilot",
    });
    expect(message.text).toContain(`a<b>&"c"`);
    expect(message.html).not.toContain("<b>");
    expect(message.html).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
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
    create: vi.fn(),
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
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "missing@example.com" },
      select: { id: true, email: true, locale: true },
    });
  });

  it("stores only the hash and emails the raw token once", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "Ada@Example.com",
      locale: "en",
    });
    const sent: { text: string; to: string }[] = [];

    await requestPasswordReset({
      email: "  ADA@example.com ",
      origin: "https://app.example/",
      sender: async (message) => {
        sent.push(message);
      },
      now: NOW,
    });

    expect(mockPrisma.user.findUnique.mock.calls[0][0].where.email).toBe("ada@example.com");
    const created = tx.passwordReset.create.mock.calls[0][0].data;
    const token = sent[0]?.text.match(/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(created.tokenHash).toBe(hashResetToken(token!));
    expect(JSON.stringify(created)).not.toContain(token);
    expect(created.expiresAt).toEqual(resetExpiry(NOW));
    expect(sent[0]?.to).toBe("Ada@Example.com");
    expect(sent[0]?.text).toContain(`https://app.example/reset-password/${token}`);
    expect(tx.passwordReset.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: NOW },
    });
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
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.passwordReset.findFirst.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      createdAt: { gt: new Date(NOW.getTime() - RESET_COOLDOWN_MS) },
    });
  });

  it("retires the link when the send fails, and does not throw", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      locale: "en",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      requestPasswordReset({
        email: "ada@example.com",
        origin: "https://app.example",
        sender: async () => {
          throw new Error("resend down");
        },
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    const created = tx.passwordReset.create.mock.calls[0][0].data;
    expect(mockPrisma.passwordReset.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: created.tokenHash, usedAt: null },
      data: { usedAt: NOW },
    });
  });
});

describe("resetPassword", () => {
  it("claims the unused unexpired link and sets the password in one transaction", async () => {
    const ok = await resetPassword("raw-token-value-1234567890", "new-password", NOW);

    expect(ok).toBe(true);
    expect(tx.passwordReset.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        tokenHash: hashResetToken("raw-token-value-1234567890"),
        usedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW },
    });
    expect(tx.user.update.mock.calls[0][0].where).toEqual({ id: "user-1" });
    expect(tx.user.update.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(tx.passwordReset.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it("changes nothing when the link was already used or has expired", async () => {
    tx.passwordReset.updateMany.mockResolvedValueOnce({ count: 0 });

    expect(await resetPassword("raw-token-value-1234567890", "new-password", NOW)).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
