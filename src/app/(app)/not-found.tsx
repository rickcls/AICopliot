import Link from "next/link";
import { Card } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

/**
 * Reached when a signed-in page calls `notFound()` — most often a project,
 * document, or report ID that does not resolve.
 *
 * The wording avoids "does not exist": per `requireProject`, a record belonging
 * to another workspace deliberately 404s rather than 403s, and this page must
 * not undo that by confirming the ID is real.
 */
export default async function AppNotFound() {
  const t = await getT();
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="text-lg font-semibold text-slate-900">
        {t("errors.notFoundTitle")}
      </h1>
      <p className="mt-2 text-sm text-slate-600">{t("errors.notFoundBody")}</p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href="/today" className="text-slate-900 underline">
          {t("errors.goToToday")}
        </Link>
        <Link href="/projects" className="text-slate-900 underline">
          {t("errors.browseProjects")}
        </Link>
      </div>
    </Card>
  );
}
