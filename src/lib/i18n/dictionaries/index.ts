import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/translate";
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
