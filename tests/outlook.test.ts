import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminConsentUrl,
  buildAuthUrl,
  exchangeCode,
  needsAdminConsent,
  OAuthError,
  refreshAccessToken,
} from "@/lib/outlook/oauth";

const KEY = Buffer.alloc(32, 7).toString("base64");

const mockPrisma = {
  integrationAccount: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  capture: { findMany: vi.fn(), findFirst: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    MICROSOFT_CLIENT_ID: "ms-client",
    MICROSOFT_CLIENT_SECRET: "ms-secret",
    INTEGRATION_ENCRYPTION_KEY: KEY,
    APP_URL: "https://app.example",
  }),
}));
const mockCreateCapture = vi.fn();
const mockGetCapture = vi.fn();
vi.mock("@/lib/capture/service", () => ({ createCapture: mockCreateCapture, getCapture: mockGetCapture }));

const service = await import("@/lib/outlook/service");
const { seal, open, parseKey } = await import("@/lib/crypto/secretbox");

/**
 * Outlook through Microsoft Graph: read-only, for company and personal
 * accounts. Microsoft rotates refresh tokens and may need a company's IT to
 * approve the app — the two places it differs from Gmail.
 */

const access = {
  workspaceId: "ws-1",
  workspaceName: "Ops",
  userId: "u-1",
  role: "member" as const,
  user: { id: "u-1", email: "rick@example.com", name: "Rick" },
};

function storedAccount(extra: Record<string, unknown> = {}) {
  const sealed = seal("refresh-old", parseKey(KEY)!);
  return {
    id: "acct-1",
    email: "rick@company.hk",
    encryptedToken: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.tag,
    needsReconnect: false,
    ...extra,
  };
}

/** Microsoft's token endpoint plus whatever Graph paths a test needs. */
function microsoftFetch(routes: Record<string, unknown>, token: Record<string, unknown> = { access_token: "access-1" }) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/token")) {
      return Response.json(token, { status: "error" in token ? 400 : 200 });
    }
    for (const [prefix, json] of Object.entries(routes)) {
      if (url.includes(prefix)) return Response.json(json);
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch & { mock: { calls: [string, RequestInit?][] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.capture.findMany.mockResolvedValue([]);
  mockPrisma.integrationAccount.findUnique.mockResolvedValue(storedAccount());
});

describe("Outlook sign-in", () => {
  it("asks for read-only mail through the endpoint that takes company and personal accounts", () => {
    const url = new URL(buildAuthUrl({ clientId: "ms-client", redirectUri: "https://app.example/cb", state: "s1", verifier: "v1" }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access User.Read Mail.Read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("tells a company's missing approval apart from a failure", () => {
    expect(needsAdminConsent("access_denied", "AADSTS65001: The user or administrator has not consented")).toBe(true);
    expect(needsAdminConsent("access_denied", "AADSTS90094: Admin consent is required")).toBe(true);
    expect(needsAdminConsent("consent_required", null)).toBe(true);
    expect(needsAdminConsent("access_denied", "AADSTS65004: User declined to consent")).toBe(false);
    expect(adminConsentUrl("ms-client")).toBe(
      "https://login.microsoftonline.com/organizations/adminconsent?client_id=ms-client",
    );
  });

  it("keeps the rotated refresh token, or the old one when none is returned", async () => {
    const rotated = await refreshAccessToken(microsoftFetch({}, { access_token: "a", refresh_token: "refresh-new" }), {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "refresh-old",
    });
    expect(rotated.refreshToken).toBe("refresh-new");
    const kept = await refreshAccessToken(microsoftFetch({}, { access_token: "a" }), {
      clientId: "c",
      clientSecret: "s",
      refreshToken: "refresh-old",
    });
    expect(kept.refreshToken).toBe("refresh-old");
  });

  it("reports Microsoft's error code", async () => {
    const error = await exchangeCode(microsoftFetch({}, { error: "invalid_grant", error_description: "AADSTS70008" }), {
      clientId: "c",
      clientSecret: "s",
      redirectUri: "r",
      code: "x",
      verifier: "v",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("invalid_grant");
  });
});

describe("Outlook connection", () => {
  it("stores the refresh token only encrypted", async () => {
    await service.saveOutlookConnection("u-1", { refreshToken: "refresh-old", scope: "Mail.Read", email: "rick@company.hk" });
    const data = mockPrisma.integrationAccount.upsert.mock.calls[0][0].create;
    expect(JSON.stringify(data)).not.toContain("refresh-old");
    expect(data).toMatchObject({ userId: "u-1", provider: "microsoft", email: "rick@company.hk" });
    expect(service.outlookRedirectUri("http://localhost:3000/x")).toBe(
      "https://app.example/api/integrations/microsoft/callback",
    );
  });

  it("stores a rotated refresh token, sealed, after using the old one", async () => {
    const fetcher = microsoftFetch({ "/me/mailFolders/inbox/messages": { value: [] } }, {
      access_token: "access-1",
      refresh_token: "refresh-new",
    });
    await service.listRecentOutlookMail(access, fetcher);
    const data = mockPrisma.integrationAccount.update.mock.calls[0][0].data;
    expect(open({ ciphertext: data.encryptedToken, iv: data.iv, tag: data.authTag }, parseKey(KEY)!)).toBe("refresh-new");
  });

  it("asks for a reconnect when Microsoft refuses the refresh token", async () => {
    const fetcher = microsoftFetch({}, { error: "invalid_grant" });
    await expect(service.listRecentOutlookMail(access, fetcher)).rejects.toMatchObject({ code: "reconnect" });
    expect(mockPrisma.integrationAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { needsReconnect: true },
    });
  });
});

describe("Check Outlook", () => {
  it("lists recent Focused-inbox headers only, and marks those already captured", async () => {
    const fetcher = microsoftFetch({
      "/me/mailFolders/inbox/messages": {
        value: [
          { id: "msg-aaaaaaaaaa1", subject: "報價", from: { emailAddress: { name: "Peter Chan", address: "peter@abc.hk" } }, receivedDateTime: "2026-10-20T01:00:00Z", bodyPreview: "請於週五前…", inferenceClassification: "focused" },
          { id: "msg-aaaaaaaaaa2", subject: "Sale!", from: { emailAddress: { address: "promo@shop.hk" } }, inferenceClassification: "other" },
        ],
      },
    });
    mockPrisma.capture.findMany.mockResolvedValue([{ id: "cap-1", externalId: "outlook:msg-aaaaaaaaaa1" }]);

    const list = await service.listRecentOutlookMail(access, fetcher, new Date("2026-10-21T02:00:00Z"));

    expect(list).toEqual([
      { id: "msg-aaaaaaaaaa1", from: "Peter Chan <peter@abc.hk>", subject: "報價", date: "2026-10-20T01:00:00Z", snippet: "請於週五前…", captureId: "cap-1" },
    ]);
    const listUrl = new URL(fetcher.mock.calls.find(([url]) => url.includes("/messages?"))![0]);
    expect(listUrl.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-10-18T02:00:00.000Z");
    // Headers only: the body is never asked for when listing.
    expect(listUrl.searchParams.get("$select")).not.toContain("body,");
    expect(mockPrisma.capture.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws-1", userId: "u-1" });
  });

  it("captures one chosen email from its own words, once per person", async () => {
    const fetcher = microsoftFetch({
      "/me/messages/": {
        subject: "Quote",
        from: { emailAddress: { name: "Peter", address: "peter@abc.hk" } },
        receivedDateTime: "2026-10-20T01:00:00Z",
        uniqueBody: { contentType: "text", content: "Please send the quote by Friday.\n\nFrom: Rick\nSent: Monday" },
      },
    });
    mockPrisma.capture.findFirst.mockResolvedValue(null);
    mockCreateCapture.mockResolvedValue({ id: "cap-9" });

    await service.captureOutlookEmail(access, "msg-aaaaaaaaaa1", fetcher);

    const [, input] = mockCreateCapture.mock.calls[0];
    expect(input).toMatchObject({ source: "email", externalId: "outlook:msg-aaaaaaaaaa1" });
    expect(input.text).toBe("From: Peter <peter@abc.hk>\nSubject: Quote\nDate: 2026-10-20T01:00:00Z\n\nPlease send the quote by Friday.");
    const [, init] = fetcher.mock.calls.find(([url]) => url.includes("/me/messages/"))!;
    expect((init?.headers as Record<string, string>).Prefer).toBe('outlook.body-content-type="text"');

    mockPrisma.capture.findFirst.mockResolvedValue({ id: "cap-9" });
    await service.captureOutlookEmail(access, "msg-aaaaaaaaaa1", fetcher);
    expect(mockCreateCapture).toHaveBeenCalledTimes(1);
    expect(mockGetCapture).toHaveBeenCalledWith(access, "cap-9");
  });

  it("reads HTML when that is all a mailbox returns, and refuses a malformed id", async () => {
    expect(service.outlookMessageText({ body: { contentType: "html", content: "<p>Hi</p><p>Send it</p>" } })).toBe("Hi\nSend it");
    await expect(service.captureOutlookEmail(access, "../../me", microsoftFetch({}))).rejects.toMatchObject({ code: "bad_id" });
  });
});
