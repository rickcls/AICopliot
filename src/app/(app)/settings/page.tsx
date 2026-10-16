import { SettingsPanel } from "@/components/settings-panel";
import { requireWorkspace, getUserPreferences } from "@/lib/auth-guard";
import { getLocale, getT } from "@/lib/i18n/server";
import { DEFAULT_TIME_ZONE } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The zone list is built on the server and passed down, so the options cannot
 * differ between the server render and a browser with a different ICU build.
 * The saved zone is always offered, even if this runtime does not list it.
 */
function timeZoneOptions(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  zones.add(current);
  return [...zones].sort();
}

export default async function SettingsPage() {
  const { userId } = await requireWorkspace();
  const [t, locale, preferences] = await Promise.all([
    getT(),
    getLocale(),
    getUserPreferences(userId),
  ]);
  const timeZone = preferences?.timeZone ?? DEFAULT_TIME_ZONE;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("settings.lead")}</p>
      </div>
      <SettingsPanel
        locale={locale}
        timeZone={timeZone}
        timeZones={timeZoneOptions(timeZone)}
      />
    </div>
  );
}
