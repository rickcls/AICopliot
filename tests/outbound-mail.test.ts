import { describe, expect, it, vi } from "vitest";
import {
  OutboundMailError,
  mailDelivery,
  mailSettingsFrom,
  sendWithResend,
  type TransactionalEmail,
} from "@/lib/outbound/mail";

const message: TransactionalEmail = {
  to: "ada@example.com",
  subject: "Reset your ScopePilot password",
  text: "Use this link",
  html: "<p>Use this link</p>",
};

describe("mailSettingsFrom", () => {
  it("needs both the key and the from-address", () => {
    expect(mailSettingsFrom({})).toBeNull();
    expect(mailSettingsFrom({ RESEND_API_KEY: "re_test" })).toBeNull();
    expect(mailSettingsFrom({ EMAIL_FROM: "ScopePilot <a@b.co>" })).toBeNull();
    expect(mailSettingsFrom({ RESEND_API_KEY: "  ", EMAIL_FROM: "a@b.co" })).toBeNull();
    expect(
      mailSettingsFrom({ RESEND_API_KEY: " re_test ", EMAIL_FROM: " ScopePilot <a@b.co> " }),
    ).toEqual({ apiKey: "re_test", from: "ScopePilot <a@b.co>" });
  });
});

describe("mailDelivery", () => {
  const settings = { apiKey: "re_test", from: "a@b.co" };

  it("sends when configured, logs in development, and refuses in production", () => {
    expect(mailDelivery(settings, "production")).toBe("resend");
    expect(mailDelivery(settings, "development")).toBe("resend");
    expect(mailDelivery(null, "development")).toBe("log");
    expect(mailDelivery(null, "test")).toBe("log");
    expect(mailDelivery(null, "production")).toBe("unavailable");
  });
});

describe("sendWithResend", () => {
  it("posts the message to Resend and does not follow the page", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await sendWithResend(message, { apiKey: "re_test", from: "ScopePilot <a@b.co>" }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test" });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "ScopePilot <a@b.co>",
      to: ["ada@example.com"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("rejects a non-ok response without reading it into the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret body", { status: 422 }));

    await expect(
      sendWithResend(message, { apiKey: "re_test", from: "a@b.co" }, fetchImpl),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(
      sendWithResend(message, { apiKey: "re_test", from: "a@b.co" }, fetchImpl),
    ).rejects.toBeInstanceOf(OutboundMailError);
  });
});
