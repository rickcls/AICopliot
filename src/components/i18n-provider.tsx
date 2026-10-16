"use client";

import { createContext, useContext, useMemo } from "react";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Hands the server-resolved locale to client components. The locale comes in
 * as a prop from the root layout rather than being read from a cookie here, so
 * the server render and hydration always agree.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
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
