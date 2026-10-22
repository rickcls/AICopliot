import { LinkButton } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

/**
 * Unmatched URLs, which may well be reached by someone who is not signed in —
 * so this renders in the bare root layout with no sidebar and links only to
 * public destinations.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs font-semibold tracking-wide text-sand-400 uppercase">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-sand-900">
        {t("errors.publicNotFoundTitle")}
      </h1>
      <p className="mt-2 max-w-md text-sm text-sand-600">
        {t("errors.publicNotFoundBody")}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">{t("errors.backHome")}</LinkButton>
        <LinkButton href="/today" variant="secondary">
          {t("errors.goToToday")}
        </LinkButton>
      </div>
    </main>
  );
}
