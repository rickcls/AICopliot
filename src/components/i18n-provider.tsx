"use client";

import { createContext, useContext, useMemo } from "react";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, intlLocale, type Locale } from "@/lib/i18n/locales";
import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
const TimeZoneContext = createContext<string>(DEFAULT_TIME_ZONE);

/**
 * Hands the server-resolved locale to client components. The locale comes in
 * as a prop from the root layout rather than being read from a cookie here, so
 * the server render and hydration always agree.
 */
export function I18nProvider({
  locale,
  timeZone,
  children,
}: {
  locale: Locale;
  /** The viewer's zone, so timestamps render the same on server and client. */
  timeZone: string;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(
    () => createTranslator(locale, DICTIONARIES[locale], DICTIONARIES.en),
    [locale],
  );
}

/** The viewer's time zone, for formatting instants. */
export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

/** The `Intl` locale for dates and lists, e.g. `zh-HK` for `zh-Hant`. */
export function useDateLocale(): string {
  return intlLocale(useLocale());
}
