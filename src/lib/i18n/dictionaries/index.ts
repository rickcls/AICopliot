import type { Locale } from "@/lib/i18n/locales";
import { createTranslator, type Dictionary, type Translate } from "@/lib/i18n/translate";
import { en } from "@/lib/i18n/dictionaries/en";
import { zhHant } from "@/lib/i18n/dictionaries/zh-Hant";

/**
 * Both dictionaries are imported statically. They are a few kilobytes each,
 * and a static import keeps the client provider free of loading states.
 */
export const DICTIONARIES: Record<Locale, Dictionary> = {
  "zh-Hant": zhHant,
  en,
};

/** `t` for a locale chosen by the caller rather than the viewer — a file for a client, a test. */
export function translatorFor(locale: Locale): Translate {
  return createTranslator(locale, DICTIONARIES[locale], DICTIONARIES.en);
}
