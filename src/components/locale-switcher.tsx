"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Segment, SegmentedControl } from "@/components/ui";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

/** Short marks on the buttons; the full language name is the accessible name. */
const MARK: Record<Locale, string> = { "zh-Hant": "中", en: "EN" };
const NAME_KEY = { "zh-Hant": "locale.zhHant", en: "locale.en" } as const;

/**
 * Switches the UI language. Saved to the person's row (so it follows them to
 * another device) and to a cookie (so the sign-in page keeps it), then the
 * server components re-render in the new language with `router.refresh()`.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useT();
  const current = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function choose(locale: Locale) {
    if (locale === current || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        toast.error(t("settings.saveFailed"));
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SegmentedControl label={t("locale.label")} className={className}>
      {LOCALES.map((locale) => (
        <Segment
          key={locale}
          lang={locale === "zh-Hant" ? "zh-Hant-HK" : "en"}
          pressed={current === locale}
          title={t(NAME_KEY[locale])}
          disabled={saving}
          onClick={() => void choose(locale)}
          className="px-1.5"
        >
          <span aria-hidden>{MARK[locale]}</span>
          <span className="sr-only">{t(NAME_KEY[locale])}</span>
        </Segment>
      ))}
    </SegmentedControl>
  );
}
