/**
 * The deterministic check on a drafted email: every date, time, amount,
 * number, address, and link in the draft must appear in something the person
 * gave — their key points, the email they are replying to, the task's facts,
 * or their signature. Anything else is flagged for them to check before
 * sending. The draft is not changed: a flag is a question, and the person may
 * well know the fact is right.
 *
 * Bracketed placeholders ("[date]", "【日期】") are flagged too — they are
 * where the model was told to leave a gap rather than guess.
 */

export type FactKind =
  | "date"
  | "time"
  | "weekday"
  | "money"
  | "percent"
  | "number"
  | "email"
  | "url"
  | "placeholder";

export interface FactFlag {
  kind: FactKind;
  text: string;
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Most specific first; a span claimed by one pattern is not re-read by later ones. */
const PATTERNS: [FactKind, RegExp][] = [
  ["placeholder", /\[[^\]\n]{1,30}\]|【[^】\n]{1,30}】/g],
  ["url", /https?:\/\/[^\s)>\]]+/gi],
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["money", /(?:HK\$|US\$|RMB|NT\$|\$|¥|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|萬|千|百萬))?|\d[\d,]*(?:\.\d+)?\s?(?:港元|美元|人民幣|元|蚊|萬元)/gi],
  ["percent", /\d+(?:\.\d+)?\s?%/g],
  ["date", /\d{4}-\d{1,2}-\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日號号]|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g],
  ["date", new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b\\.?(?:\\s+\\d{4})?|\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi")],
  ["time", /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b|(?:上午|下午|晚上|早上|下晝|朝早|中午)?\d{1,2}[點点](?:\d{1,2}分|半|鐘)?/gi],
  ["weekday", /\b(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?\b|(?:星期|禮拜|週|周)[一二三四五六日天]/gi],
  ["number", /\d[\d,]*(?:\.\d+)?/g],
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[\s,，]/g, "");
}

export function findUnsupportedFacts(draft: string, inputs: readonly (string | null | undefined)[]): FactFlag[] {
  const given = normalise(inputs.filter(Boolean).join("\n"));
  const claimed: [number, number][] = [];
  const flags: FactFlag[] = [];
  const seen = new Set<string>();

  for (const [kind, pattern] of PATTERNS) {
    for (const match of draft.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (claimed.some(([from, to]) => start < to && end > from)) continue;
      claimed.push([start, end]);

      const text = match[0].trim();
      // A lone digit ("2 weeks", "step 1") is not a fact worth a flag.
      if (kind === "number" && text.replace(/\D/g, "").length < 2) continue;
      if (kind !== "placeholder" && given.includes(normalise(text))) continue;
      const key = `${kind}:${normalise(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push({ kind, text });
    }
  }
  return flags;
}
