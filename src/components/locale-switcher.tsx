"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { FOCUS_RING } from "@/components/ui";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

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
    <div
      role="group"
      aria-label={t("locale.label")}
      className={cn(
        "inline-flex rounded-lg border border-sand-200 bg-sand-50 p-0.5",
        className,
      )}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale === "zh-Hant" ? "zh-Hant-HK" : "en"}
          aria-pressed={current === locale}
          title={t(NAME_KEY[locale])}
          disabled={saving}
          onClick={() => void choose(locale)}
          className={cn(
            "grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs font-medium transition-colors",
            FOCUS_RING,
            current === locale
              ? "bg-white text-sand-900 shadow-sm"
              : "text-sand-400 hover:text-sand-900",
          )}
        >
          <span aria-hidden>{MARK[locale]}</span>
          <span className="sr-only">{t(NAME_KEY[locale])}</span>
        </button>
      ))}
    </div>
  );
}
