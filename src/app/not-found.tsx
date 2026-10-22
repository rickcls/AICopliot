import { SearchX } from "lucide-react";
import { LinkButton, MessagePanel } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

/**
 * Unmatched URLs, which may well be reached by someone who is not signed in —
 * so this renders in the bare root layout with no sidebar and links only to
 * public destinations.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-linear-to-b from-brand-50/70 via-sand-50 to-sand-50 px-6 py-16">
      <MessagePanel
        headingLevel={1}
        icon={<SearchX className="size-6" />}
        title={t("errors.publicNotFoundTitle")}
        actions={
          <>
            <LinkButton href="/">{t("errors.backHome")}</LinkButton>
            <LinkButton href="/today" variant="secondary">
              {t("errors.goToToday")}
            </LinkButton>
          </>
        }
      >
        <p>{t("errors.publicNotFoundBody")}</p>
      </MessagePanel>
    </main>
  );
}
