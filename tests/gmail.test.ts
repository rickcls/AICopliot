import { describe, expect, it, vi } from "vitest";
import { open, parseKey, seal } from "@/lib/crypto/secretbox";
import {
  decodeBase64Url,
  emailCaptureBody,
  extractEmailText,
  htmlToText,
  stripQuotedReply,
} from "@/lib/gmail/message";
import {
  buildAuthUrl,
  exchangeCode,
  GMAIL_READONLY_SCOPE,
  OAuthError,
  pkceChallenge,
  refreshAccessToken,
} from "@/lib/gmail/oauth";

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("secretbox", () => {
  const key = parseKey(Buffer.alloc(32, 7).toString("base64"))!;

  it("round-trips a secret, with a fresh IV each time", () => {
    const a = seal("refresh-token-123", key);
    const b = seal("refresh-token-123", key);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(open(a, key)).toBe("refresh-token-123");
  });

  it("refuses a tampered ciphertext or the wrong key", () => {
    const sealed = seal("secret", key);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 1;
    expect(() => open({ ...sealed, ciphertext: flipped.toString("base64") }, key)).toThrow();
    expect(() => open(sealed, parseKey(Buffer.alloc(32, 8).toString("base64"))!)).toThrow();
  });

  it("accepts only a 32-byte key", () => {
    expect(parseKey(undefined)).toBeNull();
    expect(parseKey(Buffer.alloc(16).toString("base64"))).toBeNull();
  });
});

describe("Google OAuth", () => {
  it("asks for read-only Gmail, offline, with PKCE", () => {
    const url = new URL(
      buildAuthUrl({ clientId: "cid", redirectUri: "https://app/cb", state: "st", verifier: "ver" }),
    );
    expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("ver"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a code with the verifier and requires a refresh token", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ access_token: "at", refresh_token: "rt", scope: GMAIL_READONLY_SCOPE }),
    );
    const tokens = await exchangeCode(fetcher as unknown as typeof fetch, {
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "https://app/cb",
      code: "code",
      verifier: "ver",
    });
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", scope: GMAIL_READONLY_SCOPE });
    const body = new URLSearchParams(fetcher.mock.calls[0][1].body as string);
    expect(body.get("code_verifier")).toBe("ver");

    const noRefresh = vi.fn(async () => Response.json({ access_token: "at" }));
    await expect(
      exchangeCode(noRefresh as unknown as typeof fetch, {
        clientId: "cid",
        clientSecret: "s",
        redirectUri: "r",
        code: "c",
        verifier: "v",
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("reports Google's error code when a refresh token is dead", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }),
    );
    await expect(
      refreshAccessToken(fetcher as unknown as typeof fetch, { clientId: "c", clientSecret: "s", refreshToken: "r" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("reading a Gmail message", () => {
  it("decodes base64url bodies, Chinese included", () => {
    expect(decodeBase64Url(b64url("請於星期五前回覆"))).toBe("請於星期五前回覆");
  });

  it("prefers the plain-text part of a multipart message", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain body") } },
        { mimeType: "text/html", body: { data: b64url("<p>HTML body</p>") } },
      ],
    };
    expect(extractEmailText(payload)).toBe("Plain body");
  });

  it("reduces HTML to text when there is no plain part", () => {
    expect(htmlToText("<style>p{}</style><p>Hi&nbsp;Rick,</p><p>See <b>attached</b>.<br>Thanks</p>")).toBe(
      "Hi Rick,\nSee attached.\nThanks",
    );
  });

  it("cuts the quoted history below a reply", () => {
    expect(stripQuotedReply("Sounds good, send it Friday.\n\nOn Mon, 12 Oct 2026, Peter <p@abc.com> wrote:\n> old text")).toBe(
      "Sounds good, send it Friday.",
    );
    expect(stripQuotedReply("收到，謝謝。\n\n寄件者: Peter\n寄件日期: …")).toBe("收到，謝謝。");
  });

  it("builds a capture body with who, what, and when", () => {
    const body = emailCaptureBody({
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Peter <p@abc.com>" },
        { name: "Subject", value: "Quote" },
        { name: "Date", value: "Fri, 16 Oct 2026 10:00:00 +0800" },
      ],
      body: { data: b64url("Please send the quote by Friday.") },
    });
    expect(body).toBe(
      "From: Peter <p@abc.com>\nSubject: Quote\nDate: Fri, 16 Oct 2026 10:00:00 +0800\n\nPlease send the quote by Friday.",
    );
  });
});
