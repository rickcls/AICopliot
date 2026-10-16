/**
 * Turns the words a person used for a deadline into a calendar day.
 *
 * The model is never trusted with this. It returns the exact phrase it read
 * ("下星期五", "by Thursday", "23/10"), and this module — pure, tested —
 * decides the date against the day the capture was written. A phrase it cannot
 * read returns null, and a null date is shown as "no date", never guessed: a
 * wrong deadline on a task is worse than none.
 *
 * Conventions, pinned by tests/capture-dates.test.ts:
 * - Hong Kong writes day before month: "3/1" is 3 January.
 * - A bare weekday ("星期五", "Friday") is its next occurrence, today included.
 * - "下星期五" / "next Friday" is that weekday in the following Monday-based week.
 * - A date without a year is this year, or next year if that is more than 60
 *   days ago ("3/1" written in October means next January).
 * - Vague phrases ("下星期", "遲啲", "soon", "ASAP", "next week") are null.
 *
 * All arithmetic is on UTC midnights, like every date-only value in the app.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_YEAR_ROLLOVER_DAYS = 60;

function fromIso(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Monday = 1 … Sunday = 7. */
function isoWeekday(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/** A real calendar date, or null for 31/2 and the like. */
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function endOfMonth(anchor: Date, monthsAhead: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthsAhead + 1, 0));
}

function nextOccurrence(anchor: Date, weekday: number): Date {
  return addDays(anchor, (weekday - isoWeekday(anchor) + 7) % 7);
}

function inThisWeek(anchor: Date, weekday: number): Date {
  return addDays(anchor, weekday - isoWeekday(anchor));
}

function inNextWeek(anchor: Date, weekday: number): Date {
  return addDays(inThisWeek(anchor, weekday), 7);
}

/** A day and month with no year: this year, unless that is well in the past. */
function withInferredYear(anchor: Date, month: number, day: number): Date | null {
  const thisYear = makeDate(anchor.getUTCFullYear(), month, day);
  if (!thisYear) return null;
  if (anchor.getTime() - thisYear.getTime() > PAST_YEAR_ROLLOVER_DAYS * DAY_MS) {
    return makeDate(anchor.getUTCFullYear() + 1, month, day);
  }
  return thisYear;
}

function expandYear(value: string): number {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** "3", "十", "十二", "二十", "廿一", "三十一" → number; anything else → null. */
function parseCount(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const text = value.replace(/^廿/, "二十");
  if (text === "十") return 10;
  const tens = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  if (tens) {
    return (tens[1] ? CHINESE_DIGITS[tens[1]] : 1) * 10 + (tens[2] ? CHINESE_DIGITS[tens[2]] : 0);
  }
  return text.length === 1 && text in CHINESE_DIGITS ? CHINESE_DIGITS[text] : null;
}

const CHINESE_WEEKDAY: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

const ENGLISH_WEEKDAY: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};
const WEEKDAY_WORD = Object.keys(ENGLISH_WEEKDAY)
  .sort((a, b) => b.length - a.length)
  .join("|");

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_WORD =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthNumber(word: string): number {
  return MONTHS[word.slice(0, word.startsWith("sept") ? 4 : 3)] ?? MONTHS[word.slice(0, 3)];
}

const WEEK_WORD = "(?:星期|禮拜|週|周)";
const CN_WEEKDAY = "([一二三四五六日天])";
const CN_COUNT = "(\\d{1,2}|[一二兩三四五六七八九十廿]{1,3})";

type Rule = (text: { lower: string; compact: string }, anchor: Date) => Date | null | undefined;

/**
 * Most specific first; the first rule that yields a real date wins. A rule
 * that matches but yields no real date (31/2) falls through to the next, so a
 * stray number cannot hide the "聽日" beside it.
 */
const RULES: Rule[] = [
  // 2026-10-23, 2026/10/23
  ({ compact }) => {
    const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(compact);
    return m ? makeDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
  },
  // 2026年10月23日, 10月23日, 10月23號
  ({ compact }, anchor) => {
    const m = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日號号]/.exec(compact);
    if (!m) return undefined;
    return m[1]
      ? makeDate(Number(m[1]), Number(m[2]), Number(m[3]))
      : withInferredYear(anchor, Number(m[2]), Number(m[3]));
  },
  // 下個月5號 — the 5th of next month.
  ({ compact }, anchor) => {
    const m = /下(?:個)?月(\d{1,2})[號日号]/.exec(compact);
    if (!m) return undefined;
    const next = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    return makeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, Number(m[1]));
  },
  // 23/10, 23/10/2026, 23/10/26 — day first. A dot only counts with a year
  // (23.10.2026): "12.10" on its own is a time far more often than a date.
  ({ compact }, anchor) => {
    const m =
      /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/.exec(compact) ??
      /(?<![\d/.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/.exec(compact);
    if (!m) return undefined;
    return m[3]
      ? makeDate(expandYear(m[3]), Number(m[2]), Number(m[1]))
      : withInferredYear(anchor, Number(m[2]), Number(m[1]));
  },
  // 23 Oct, 23rd October 2026
  ({ lower }, anchor) => {
    const m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\.?(?:,?\\s+(\\d{4}))?\\b`).exec(lower);
    if (!m) return undefined;
    const month = monthNumber(m[2]);
    return m[3] ? makeDate(Number(m[3]), month, Number(m[1])) : withInferredYear(anchor, month, Number(m[1]));
  },
  // Oct 23, October 23rd, 2026
  ({ lower }, anchor) => {
    const m = new RegExp(`\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(lower);
    if (!m) return undefined;
    const month = monthNumber(m[1]);
    return m[3] ? makeDate(Number(m[3]), month, Number(m[2])) : withInferredYear(anchor, month, Number(m[2]));
  },
  // N日後 / N天後 / N日之後
  ({ compact }, anchor) => {
    const m = new RegExp(`${CN_COUNT}(?:日|天)(?:之)?後`).exec(compact);
    if (!m) return undefined;
    const count = parseCount(m[1]);
    return count === null ? null : addDays(anchor, count);
  },
  // 大後日 before 後日 before 聽日; each Cantonese and written form.
  ({ compact }, anchor) => (/大後[日天]/.test(compact) ? addDays(anchor, 3) : undefined),
  // Guards keep 最後日期 ("deadline") and 說明 / 證明 / 聲明 from reading as days.
  ({ compact }, anchor) =>
    /(?<![最之])後[日天]/.test(compact) ? addDays(anchor, 2) : undefined,
  ({ compact }, anchor) =>
    /聽[日朝晚]|(?<![說證聲表發透])明[天日早晚朝]/.test(compact)
      ? addDays(anchor, 1)
      : undefined,
  ({ compact }, anchor) => (/今[日天晚朝早]/.test(compact) ? anchor : undefined),
  // 下個月尾 before 月尾.
  ({ compact }, anchor) => (/下(?:個)?月[尾底]/.test(compact) ? endOfMonth(anchor, 1) : undefined),
  ({ compact }, anchor) => (/月[尾底]/.test(compact) ? endOfMonth(anchor, 0) : undefined),
  // 下星期五 / 下個禮拜一 / 下週三
  ({ compact }, anchor) => {
    const m = new RegExp(`下(?:個)?${WEEK_WORD}${CN_WEEKDAY}`).exec(compact);
    return m ? inNextWeek(anchor, CHINESE_WEEKDAY[m[1]]) : undefined;
  },
  // 今個星期五 / 呢個禮拜三 / 本週一 / 這個星期二
  ({ compact }, anchor) => {
    const m = new RegExp(`(?:今個|呢個|這個|本|今)${WEEK_WORD}${CN_WEEKDAY}`).exec(compact);
    return m ? inThisWeek(anchor, CHINESE_WEEKDAY[m[1]]) : undefined;
  },
  // 星期五 / 禮拜日 / 週三
  ({ compact }, anchor) => {
    const m = new RegExp(`${WEEK_WORD}${CN_WEEKDAY}`).exec(compact);
    return m ? nextOccurrence(anchor, CHINESE_WEEKDAY[m[1]]) : undefined;
  },
  // 23號 on its own: this month if still ahead, else next month.
  ({ compact }, anchor) => {
    const m = /(?<![\d月])(\d{1,2})[號号]/.exec(compact);
    if (!m) return undefined;
    const day = Number(m[1]);
    const thisMonth = makeDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, day);
    if (thisMonth && thisMonth.getTime() >= anchor.getTime()) return thisMonth;
    const next = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    return makeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, day);
  },
  // English relative words.
  ({ lower }, anchor) => (/\bday after tomorrow\b/.test(lower) ? addDays(anchor, 2) : undefined),
  ({ lower }, anchor) => (/\b(tomorrow|tmrw?|tmw)\b/.test(lower) ? addDays(anchor, 1) : undefined),
  ({ lower }, anchor) =>
    /\b(today|tonight|this (morning|afternoon|evening)|eod|end of (the )?day|cob|close of business)\b/.test(lower)
      ? anchor
      : undefined,
  ({ lower }, anchor) => {
    const m = /\bin (\d{1,2}) days?\b|\b(\d{1,2}) days? (?:from now|later)\b/.exec(lower);
    return m ? addDays(anchor, Number(m[1] ?? m[2])) : undefined;
  },
  ({ lower }, anchor) =>
    /\b(end of next month)\b/.test(lower) ? endOfMonth(anchor, 1) : undefined,
  ({ lower }, anchor) =>
    /\b(end of (the |this )?month|eom|month[- ]end)\b/.test(lower) ? endOfMonth(anchor, 0) : undefined,
  // End of week means Friday; once Friday has passed, next week's.
  ({ lower }, anchor) => {
    if (!/\b(end of (the |this )?week|eow)\b/.test(lower)) return undefined;
    return isoWeekday(anchor) > 5 ? inNextWeek(anchor, 5) : inThisWeek(anchor, 5);
  },
  ({ lower }, anchor) => {
    const m = new RegExp(`\\bnext (${WEEKDAY_WORD})\\b`).exec(lower);
    return m ? inNextWeek(anchor, ENGLISH_WEEKDAY[m[1]]) : undefined;
  },
  ({ lower }, anchor) => {
    const m = new RegExp(`\\b(${WEEKDAY_WORD})\\b`).exec(lower);
    return m ? nextOccurrence(anchor, ENGLISH_WEEKDAY[m[1]]) : undefined;
  },
];

/**
 * The calendar day a phrase names, as `YYYY-MM-DD`, or null when it names no
 * single day. `anchorIsoDay` is the day the words were written.
 */
export function resolveDateExpression(phrase: string, anchorIsoDay: string): string | null {
  const anchor = fromIso(anchorIsoDay);
  if (Number.isNaN(anchor.getTime())) return null;

  const lower = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return null;
  const text = { lower, compact: lower.replace(/\s+/g, "") };

  for (const rule of RULES) {
    const result = rule(text, anchor);
    if (result) return toIso(result);
  }
  return null;
}

/** "Fri", "五" — for showing a resolved date with its weekday. */
export function weekdayOf(isoDay: string): number {
  return isoWeekday(fromIso(isoDay));
}
