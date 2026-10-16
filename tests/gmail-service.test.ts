import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 9).toString("base64");

const mockPrisma = {
  integrationAccount: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  capture: { findMany: vi.fn(), findFirst: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
    INTEGRATION_ENCRYPTION_KEY: KEY,
    APP_URL: "https://app.example",
  }),
}));
const mockCreateCapture = vi.fn();
const mockGetCapture = vi.fn();
vi.mock("@/lib/capture/service", () => ({ createCapture: mockCreateCapture, getCapture: mockGetCapture }));

const service = await import("@/lib/gmail/service");
const { seal, parseKey } = await import("@/lib/crypto/secretbox");

const access = {
  workspaceId: "ws-1",
  workspaceName: "Ops",
  userId: "u-1",
  role: "member" as const,
  user: { id: "u-1", email: "rick@example.com", name: "Rick" },
};
const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function storedAccount(extra: Record<string, unknown> = {}) {
  const sealed = seal("refresh-token-xyz", parseKey(KEY)!);
  return {
    id: "acct-1",
    email: "rick@gmail.com",
    encryptedToken: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.tag,
    needsReconnect: false,
    ...extra,
  };
}

function googleFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("refresh_token")).toBe("refresh-token-xyz");
      return Response.json({ access_token: "access-1" });
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
});

describe("Gmail connection", () => {
  it("stores the refresh token only encrypted, and redirects to the configured app URL", async () => {
    await service.saveGmailConnection("u-1", { refreshToken: "refresh-token-xyz", scope: "gmail.readonly", email: "rick@gmail.com" });
    const data = mockPrisma.integrationAccount.upsert.mock.calls[0][0].create;
    expect(JSON.stringify(data)).not.toContain("refresh-token-xyz");
    expect(data).toMatchObject({ userId: "u-1", provider: "google", email: "rick@gmail.com" });
    expect(service.gmailRedirectUri("http://localhost:3000/x")).toBe(
      "https://app.example/api/integrations/google/callback",
    );
  });

  it("asks for a reconnect when Google refuses the refresh token", async () => {
    mockPrisma.integrationAccount.findUnique.mockResolvedValue(storedAccount());
    const fetcher = vi.fn(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    ) as unknown as typeof fetch;

    await expect(service.listRecentMail(access, fetcher)).rejects.toMatchObject({ code: "reconnect" });
    expect(mockPrisma.integrationAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { needsReconnect: true },
    });
  });
});

describe("listRecentMail", () => {
  it("lists headers only, and marks emails already captured", async () => {
    mockPrisma.integrationAccount.findUnique.mockResolvedValue(storedAccount());
    mockPrisma.capture.findMany.mockResolvedValue([{ id: "cap-9", externalId: "gmail:m2" }]);
    const fetcher = googleFetch({
      "/messages?": { messages: [{ id: "m1" }, { id: "m2" }] },
      "/messages/m1?format=metadata": {
        id: "m1",
        snippet: "Please send the quote",
        payload: { headers: [{ name: "From", value: "Peter <p@abc.com>" }, { name: "Subject", value: "Quote" }] },
      },
      "/messages/m2?format=metadata": { id: "m2", snippet: "", payload: { headers: [] } },
    });

    const messages = await service.listRecentMail(access, fetcher);

    expect(messages).toEqual([
      { id: "m1", from: "Peter <p@abc.com>", subject: "Quote", date: "", snippet: "Please send the quote", captureId: null },
      { id: "m2", from: "", subject: "", date: "", snippet: "", captureId: "cap-9" },
    ]);
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("format=full"))).toBe(false);
    expect(mockPrisma.capture.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws-1", userId: "u-1" });
  });
});

describe("captureEmail", () => {
  it("reads the chosen email in full and captures it privately", async () => {
    mockPrisma.integrationAccount.findUnique.mockResolvedValue(storedAccount());
    mockPrisma.capture.findFirst.mockResolvedValue(null);
    mockCreateCapture.mockResolvedValue({ id: "cap-1" });
    const fetcher = googleFetch({
      "/messages/m1abcdef?format=full": {
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "Subject", value: "Quote" }],
          body: { data: b64url("Please send the quote by Friday.") },
        },
      },
    });

    await service.captureEmail(access, "m1abcdef", fetcher);

    expect(mockPrisma.capture.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: "ws-1",
      userId: "u-1",
      externalId: "gmail:m1abcdef",
    });
    const [captureAccess, input] = mockCreateCapture.mock.calls[0];
    expect(captureAccess.userId).toBe("u-1");
    expect(input).toMatchObject({ source: "email", externalId: "gmail:m1abcdef" });
    expect(input.text).toContain("Subject: Quote");
    expect(input.text).toContain("Please send the quote by Friday.");
  });

  it("returns the existing capture without reading the email again", async () => {
    mockPrisma.capture.findFirst.mockResolvedValue({ id: "cap-1" });
    mockGetCapture.mockResolvedValue({ id: "cap-1" });
    const fetcher = vi.fn() as unknown as typeof fetch;

    expect(await service.captureEmail(access, "m1abcdef", fetcher)).toEqual({ id: "cap-1" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockCreateCapture).not.toHaveBeenCalled();
  });

  it("refuses something that is not a message id", async () => {
    await expect(service.captureEmail(access, "../../evil", vi.fn() as unknown as typeof fetch)).rejects.toMatchObject({
      code: "bad_id",
    });
  });
});
