import { describe, expect, it, vi } from "vitest";
import { notifyRegistration, welcomeEmail } from "@/lib/auth/welcome-email";

describe("welcomeEmail", () => {
  it("writes Traditional Chinese or English and includes the sign-in link", () => {
    const zh = welcomeEmail({
      to: "ada@example.com",
      name: "Ada",
      locale: "zh-Hant",
      signInUrl: "https://app.example/login",
    });
    const en = welcomeEmail({
      to: "ada@example.com",
      name: "Ada",
      locale: "en",
      signInUrl: "https://app.example/login",
    });

    expect(zh.subject).toBe("你的 ScopePilot 帳戶已建立");
    expect(zh.text).toContain("Ada，你的帳戶已建立。");
    expect(zh.text).toContain("ada@example.com");
    expect(en.subject).toBe("Your ScopePilot account is ready");
    expect(en.text).toContain("https://app.example/login");
    expect(en.text).not.toMatch(/password/i);
  });

  it("escapes the name in html", () => {
    const message = welcomeEmail({
      to: "ada@example.com",
      name: `A<b>da`,
      locale: "en",
      signInUrl: "https://app.example/login",
    });
    expect(message.html).toContain("A&lt;b&gt;da");
    expect(message.html).not.toContain("<b>");
  });
});

describe("notifyRegistration", () => {
  it("does nothing when mail is not configured", async () => {
    await expect(
      notifyRegistration({
        to: "ada@example.com",
        name: "Ada",
        locale: "en",
        signInUrl: "https://app.example/login",
        sender: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps going when the send is rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sender = vi.fn(async () => {
      throw new Error("resend down");
    });

    await expect(
      notifyRegistration({
        to: "ada@example.com",
        name: "Ada",
        locale: "en",
        signInUrl: "https://app.example/login",
        sender,
      }),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledOnce();
  });
});
