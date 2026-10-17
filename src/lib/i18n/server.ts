import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getSessionUser, getUserPreferences } from "@/lib/auth-guard";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  matchAcceptLanguage,
  type Locale,
} from "@/lib/i18n/locales";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

/**
 * The viewer's UI language: their saved preference when signed in, then the
 * cookie (which keeps a choice across sign-out), then the browser's
 * Accept-Language, then the default.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getSessionUser();
  if (user) {
    const preferences = await getUserPreferences(user.id);
    if (preferences && isLocale(preferences.locale)) return preferences.locale;
  }

  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;

  return matchAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

export async function getT(): Promise<Translate> {
  const locale = await getLocale();
  return createTranslator(locale, DICTIONARIES[locale], DICTIONARIES.en);
}

/**
 * The language of a file that leaves the app — an export or a client pack.
 * `?lang=` wins, because the reader may be a client who reads the other
 * language; otherwise it is the viewer's.
 */
export async function getFileLocale(requested: unknown): Promise<Locale> {
  return isLocale(requested) ? requested : getLocale();
}
