"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Card, Select } from "@/components/ui";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

const LOCALE_NAME_KEY = { "zh-Hant": "locale.zhHant", en: "locale.en" } as const;

/**
 * Personal preferences. Each control saves as it changes — there is no form to
 * submit — and the page re-renders from the server afterwards, because both
 * settings change what the server renders (language and "today").
 */
export function SettingsPanel({
  locale,
  timeZone,
  timeZones,
}: {
  locale: Locale;
  timeZone: string;
  timeZones: string[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const languageId = useId();
  const zoneId = useId();
  const [draft, setDraft] = useState({ locale, timeZone });
  const [saving, setSaving] = useState(false);

  async function save(change: Partial<{ locale: Locale; timeZone: string }>) {
    const previous = draft;
    // Moved before the request so the select does not snap back while the
    // PATCH is in flight; restored if it fails.
    setDraft({ ...draft, ...change });
    setSaving(true);
    try {
      const response = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) {
        setDraft(previous);
        toast.error(t("settings.saveFailed"));
        return;
      }
      toast.success(t("common.saved"));
      router.refresh();
    } catch {
      setDraft(previous);
      toast.error(t("common.couldNotReach"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="divide-y divide-slate-100">
      <div className="grid gap-2 p-5 sm:grid-cols-[1fr_16rem] sm:items-center sm:gap-6">
        <div>
          <label htmlFor={languageId} className="text-sm font-semibold text-slate-900">
            {t("settings.languageTitle")}
          </label>
          <p className="mt-0.5 text-xs text-slate-500">{t("settings.languageHint")}</p>
        </div>
        <Select
          id={languageId}
          value={draft.locale}
          disabled={saving}
          onChange={(event) => void save({ locale: event.target.value as Locale })}
        >
          {LOCALES.map((option) => (
            <option key={option} value={option}>
              {t(LOCALE_NAME_KEY[option])}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-2 p-5 sm:grid-cols-[1fr_16rem] sm:items-center sm:gap-6">
        <div>
          <label htmlFor={zoneId} className="text-sm font-semibold text-slate-900">
            {t("settings.timeZoneTitle")}
          </label>
          <p className="mt-0.5 text-xs text-slate-500">{t("settings.timeZoneHint")}</p>
        </div>
        <Select
          id={zoneId}
          value={draft.timeZone}
          disabled={saving}
          onChange={(event) => void save({ timeZone: event.target.value })}
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>
    </Card>
  );
}
