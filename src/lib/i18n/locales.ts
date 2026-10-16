/**
 * The UI languages. Chinese is Traditional only: every `zh*` request maps to
 * `zh-Hant`, because serving Simplified to a Hong Kong team would be wrong, and
 * there is no Simplified dictionary to serve.
 *
 * The locale is a per-person preference (`User.locale`, mirrored in a cookie
 * for signed-out pages), never a URL segment — every page is behind sign-in,
 * so there is nothing to index per language.
 */
export const LOCALES = ["zh-Hant", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-Hant";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Value for `<html lang>`. */
export function htmlLang(locale: Locale): string {
  return locale === "zh-Hant" ? "zh-Hant-HK" : "en";
}

/** Locale handed to `Intl` formatters. */
export function intlLocale(locale: Locale): string {
  return locale === "zh-Hant" ? "zh-HK" : "en-GB";
}

/**
 * Picks the first supported language from an Accept-Language header, honouring
 * q-weights. Returns null rather than the default so the caller decides what an
 * unmatched header means.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    // Stable on ties: earlier entries win, as the header lists them.
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of ranked) {
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-Hant";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return null;
}
