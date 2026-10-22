import { SearchX } from "lucide-react";
import { LinkButton, MessagePanel } from "@/components/ui";
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
    <MessagePanel
      headingLevel={1}
      icon={<SearchX className="size-6" />}
      title={t("errors.notFoundTitle")}
      actions={
        <>
          <LinkButton href="/today">{t("errors.goToToday")}</LinkButton>
          <LinkButton href="/projects" variant="secondary">
            {t("errors.browseProjects")}
          </LinkButton>
        </>
      }
    >
      <p>{t("errors.notFoundBody")}</p>
    </MessagePanel>
  );
}
