import { describe, expect, it } from "vitest";
import { buildChatCaptureBody, parseWhatsAppChat } from "@/lib/whatsapp/parse";

/**
 * WhatsApp writes its chats differently on each phone and in each region, and
 * has no API to read them otherwise — so each shape it writes is pinned here.
 */

describe("parseWhatsAppChat", () => {
  it("reads an iPhone export, with its hidden marks and narrow spaces", () => {
    const chat = parseWhatsAppChat(
      [
        "[18/10/2026, 9:15:32 AM] Peter Chan: 聽日可唔可以send份報價俾我？",
        "‎[18/10/2026, 9:16:02 AM] Rick: 冇問題",
        "[19/10/2026, 2:05:11 PM] Peter Chan: 報價要包埋三年維護",
      ].join("\n"),
    );
    expect(chat?.messages).toEqual([
      { at: "2026-10-18 09:15", author: "Peter Chan", text: "聽日可唔可以send份報價俾我？" },
      { at: "2026-10-18 09:16", author: "Rick", text: "冇問題" },
      { at: "2026-10-19 14:05", author: "Peter Chan", text: "報價要包埋三年維護" },
    ]);
    expect(chat?.participants).toEqual(["Peter Chan", "Rick"]);
    expect([chat?.firstDay, chat?.lastDay]).toEqual(["2026-10-18", "2026-10-19"]);
  });

  it("reads an Android export, and a Chinese-region one", () => {
    const android = parseWhatsAppChat(
      "21/10/2026, 09:15 - Peter: Budget review moved to Friday\n21/10/2026, 18:40 - Rick: OK",
    );
    expect(android?.messages.map((message) => message.at)).toEqual(["2026-10-21 09:15", "2026-10-21 18:40"]);

    const chinese = parseWhatsAppChat(
      "2026/10/21 上午9:15 - 陳大文: 份合約幾時有？\n2026/10/21 下午3:05 - Rick: 等緊法務",
    );
    expect(chinese?.messages.map((message) => [message.at, message.author])).toEqual([
      ["2026-10-21 09:15", "陳大文"],
      ["2026-10-21 15:05", "Rick"],
    ]);
  });

  it("reads messages copied out of WhatsApp Desktop", () => {
    const chat = parseWhatsAppChat("[9:15 am, 21/10/2026] Peter: 開會改咗星期五\n[12:30 pm, 21/10/2026] Rick: 收到");
    expect(chat?.messages.map((message) => message.at)).toEqual(["2026-10-21 09:15", "2026-10-21 12:30"]);
  });

  it("joins a message's continuation lines, and drops system lines and placeholders", () => {
    const chat = parseWhatsAppChat(
      [
        "21/10/2026, 09:00 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
        "21/10/2026, 09:01 - Peter: 三樣嘢要跟：",
        "1. 報價",
        "2. 合約",
        "21/10/2026, 09:02 - Peter: <Media omitted>",
        "21/10/2026, 09:03 - Peter added Mary",
        "21/10/2026, 09:04 - Rick: 好",
      ].join("\n"),
    );
    expect(chat?.messages).toEqual([
      { at: "2026-10-21 09:01", author: "Peter", text: "三樣嘢要跟：\n1. 報價\n2. 合約" },
      { at: "2026-10-21 09:04", author: "Rick", text: "好" },
    ]);
  });

  it("reads day first, as Hong Kong writes it, unless a value proves month first", () => {
    const dayFirst = parseWhatsAppChat("03/10/2026, 09:00 - A: x\n04/10/2026, 09:00 - B: y");
    expect(dayFirst?.firstDay).toBe("2026-10-03");

    const monthFirst = parseWhatsAppChat("10/03/2026, 09:00 - A: x\n10/25/2026, 09:00 - B: y");
    expect(monthFirst?.firstDay).toBe("2026-10-03");
  });

  it("is not fooled by a note that mentions one time", () => {
    expect(parseWhatsAppChat("聽日 9:15 開會\n記得帶報價")).toBeNull();
    expect(parseWhatsAppChat("[21/10/2026, 9:15 AM] Peter: only one message")).toBeNull();
  });
});

describe("buildChatCaptureBody", () => {
  const messages = [
    { at: "2026-10-15 10:00", author: "Peter", text: "舊嘢" },
    { at: "2026-10-20 09:15", author: "Peter", text: "聽日send報價\n記得包維護" },
    { at: "2026-10-20 09:16", author: "Rick", text: "冇問題" },
  ];
  const omittedNote = (count: number) => `（較早的 ${count} 則訊息已略去）`;

  it("stamps each message with its own date and marks the person's own as 我", () => {
    const { body, included } = buildChatCaptureBody(messages, { me: "Rick", fromDay: "2026-10-18", omittedNote });
    expect(body).toBe("[2026-10-20 09:15] Peter：聽日send報價 / 記得包維護\n[2026-10-20 09:16] 我：冇問題");
    expect(included).toBe(2);
  });

  it("keeps the newest messages when the chat is too long, and says so", () => {
    const { body } = buildChatCaptureBody(messages, { me: "Rick", omittedNote, maxChars: 60 });
    expect(body.startsWith("（較早的")).toBe(true);
    expect(body).toContain("我：冇問題");
    expect(body).not.toContain("舊嘢");
  });
});
