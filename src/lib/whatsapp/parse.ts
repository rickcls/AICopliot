/**
 * Reads a WhatsApp chat — an exported `_chat.txt`, or messages copied out of
 * the app — into messages. Pure: it runs in the browser, so the export is
 * never uploaded, and only the part the person picks becomes a capture.
 *
 * WhatsApp has no API for personal chats, and its export format depends on
 * the phone and its region settings, so this recognises the shapes it writes:
 *
 *   iPhone   [21/10/2026, 9:15:32 AM] Peter: …       [2026/10/21 上午9:15:32] Peter: …
 *   Android  21/10/2026, 09:15 - Peter: …            2026/10/21 上午9:15 - Peter: …
 *   Copied   [9:15 am, 21/10/2026] Peter: …          [上午9:15, 2026/10/21] Peter: …
 *
 * Times carry no zone; a message's time is the phone's wall clock, kept as
 * "YYYY-MM-DD HH:mm" text rather than turned into an instant that could shift.
 */

export interface ChatMessage {
  /** "YYYY-MM-DD HH:mm", the phone's own local time. */
  at: string;
  author: string;
  text: string;
}

export interface ParsedChat {
  messages: ChatMessage[];
  /** Everyone who wrote a message, in order of first appearance. */
  participants: string[];
  /** "YYYY-MM-DD" of the first and last message. */
  firstDay: string;
  lastDay: string;
}

// Direction marks and the narrow no-break space iOS puts before AM/PM.
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
const ODD_SPACES = /[  ]/g;

const DATE = String.raw`(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})`;
const TIME = String.raw`((?:上午|下午|中午|晚上|凌晨|早上)?\s?\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?)`;

/** Each shape yields the date parts and time; the rest of the line is "author: text". */
const SHAPES: { pattern: RegExp; date: [number, number, number]; time: number; rest: number }[] = [
  // [21/10/2026, 9:15:32 AM] Peter: …   (iPhone)
  { pattern: new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s*(.*)$`), date: [1, 2, 3], time: 4, rest: 5 },
  // [9:15 am, 21/10/2026] Peter: …      (copied from WhatsApp Desktop or Web)
  { pattern: new RegExp(String.raw`^\[${TIME},\s*${DATE}\]\s*(.*)$`), date: [2, 3, 4], time: 1, rest: 5 },
  // 21/10/2026, 09:15 - Peter: …        (Android)
  { pattern: new RegExp(String.raw`^${DATE},?\s+${TIME}\s+[-–]\s+(.*)$`), date: [1, 2, 3], time: 4, rest: 5 },
];

/** Placeholders WhatsApp writes instead of content; they carry nothing to act on. */
const PLACEHOLDER =
  /^(<media omitted>|<媒體檔案已略去>|<附件：.*>|.*\b(image|video|audio|sticker|gif|document|contact card) omitted|.*(圖片|影片|語音訊息|貼圖|文件|音訊)已(略去|省略)|this message was deleted|you deleted this message|此訊息已被?刪除|你已刪除此訊息|missed (voice|video) call|null)$/i;

interface RawMessage {
  parts: [string, string, string];
  time: string;
  author: string;
  text: string;
}

function toHourMinute(time: string): string | null {
  const match = time.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2];
  const pm = /[Pp]\.?\s?[Mm]|下午|晚上|中午/.test(time);
  const am = /[Aa]\.?\s?[Mm]|上午|凌晨|早上/.test(time);
  if (pm && hour < 12 && !/中午/.test(time)) hour += 12;
  if (am && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * Which way round day and month go. Hong Kong writes day first, so that is
 * assumed until a value proves otherwise: a first number over 12 can only be
 * a day, a second number over 12 can only be a day written second.
 */
function dayFirst(messages: RawMessage[]): boolean {
  for (const { parts } of messages) {
    if (parts[0].length === 4) continue;
    if (Number(parts[0]) > 12) return true;
    if (Number(parts[1]) > 12) return false;
  }
  return true;
}

function toDay(parts: [string, string, string], dayIsFirst: boolean): string | null {
  let [year, month, day] =
    parts[0].length === 4
      ? [parts[0], parts[1], parts[2]]
      : dayIsFirst
        ? [parts[2], parts[1], parts[0]]
        : [parts[2], parts[0], parts[1]];
  if (year.length === 2) year = `20${year}`;
  month = month.padStart(2, "0");
  day = day.padStart(2, "0");
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/** The chat's messages, or null when the text is not a WhatsApp chat. */
export function parseWhatsAppChat(raw: string): ParsedChat | null {
  const lines = raw.replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(ODD_SPACES, " ").split("\n");
  const found: (RawMessage | null)[] = [];
  let stamped = 0;
  let current: RawMessage | null = null;

  for (const line of lines) {
    const shape = SHAPES.map((candidate) => ({ candidate, match: line.match(candidate.pattern) })).find(
      (attempt) => attempt.match,
    );
    if (shape?.match) {
      stamped += 1;
      const { candidate, match } = shape;
      const rest = match[candidate.rest];
      const split = rest.indexOf(": ");
      // A stamped line with no "name: " is a system line ("Peter added Mary",
      // the encryption notice). It ends the message before it.
      current =
        split > 0
          ? {
              parts: [match[candidate.date[0]], match[candidate.date[1]], match[candidate.date[2]]],
              time: match[candidate.time],
              author: rest.slice(0, split).trim(),
              text: rest.slice(split + 2),
            }
          : null;
      found.push(current);
    } else if (current && line.trim()) {
      // A line with no stamp continues the message above it.
      current.text += `\n${line}`;
    }
  }

  const messagesRaw = found.filter((message): message is RawMessage => message !== null);
  const nonEmpty = lines.filter((line) => line.trim()).length;
  // A note that happens to contain one timestamp is not a chat.
  if (messagesRaw.length < 2 || stamped < nonEmpty * 0.4) return null;

  const isDayFirst = dayFirst(messagesRaw);
  const messages: ChatMessage[] = [];
  for (const message of messagesRaw) {
    const day = toDay(message.parts, isDayFirst);
    const time = toHourMinute(message.time);
    const text = message.text.trim();
    if (!day || !time || !text || PLACEHOLDER.test(text)) continue;
    messages.push({ at: `${day} ${time}`, author: message.author, text });
  }
  if (messages.length === 0) return null;

  return {
    messages,
    participants: [...new Set(messages.map((message) => message.author))],
    firstDay: messages[0].at.slice(0, 10),
    lastDay: messages[messages.length - 1].at.slice(0, 10),
  };
}

/** A capture's text is capped; the chat is cut from its oldest end to fit. */
export const MAX_CHAT_CAPTURE_CHARS = 7800;

/**
 * The capture text for the part of the chat the person picked: one message per
 * line, stamped with its own date so a "聽日" in it is read from the day it was
 * written, and the person's own messages marked 我.
 */
export function buildChatCaptureBody(
  messages: readonly ChatMessage[],
  {
    me,
    fromDay = null,
    omittedNote,
    maxChars = MAX_CHAT_CAPTURE_CHARS,
  }: {
    me: string;
    /** "YYYY-MM-DD"; messages before it are left out. */
    fromDay?: string | null;
    /** Says how many older messages did not fit, in the person's language. */
    omittedNote: (count: number) => string;
    maxChars?: number;
  },
): { body: string; included: number } {
  const lines = messages
    .filter((message) => !fromDay || message.at.slice(0, 10) >= fromDay)
    .map((message) => {
      const who = message.author === me ? "我" : message.author;
      return `[${message.at}] ${who}：${message.text.replace(/\s*\n\s*/g, " / ")}`;
    });

  const kept: string[] = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (length + lines[index].length + 1 > maxChars) break;
    kept.unshift(lines[index]);
    length += lines[index].length + 1;
  }
  const omitted = lines.length - kept.length;
  return {
    body: [...(omitted > 0 ? [omittedNote(omitted)] : []), ...kept].join("\n"),
    included: kept.length,
  };
}
