"use client";

import { useT } from "@/components/i18n-provider";
import { Button, Card, LinkButton } from "@/components/ui";

/**
 * Failure boundary for signed-in pages without a nearer one. Without it a
 * failed query on the dashboard or documents page escapes to the global error
 * page, which replaces the whole shell — losing the navigation that lets
 * someone get somewhere that still works.
 *
 * The message stays generic because the underlying error may name internals.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useT();
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h2 className="text-sm font-semibold text-sand-900">
        {t("errors.loadFailedTitle")}
      </h2>
      <p className="mt-1 text-sm text-sand-600">{t("errors.loadFailedBody")}</p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-sand-400">
          {t("errors.reference", { digest: error.digest })}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={retry}>
          {t("errors.tryAgain")}
        </Button>
        <LinkButton href="/today" variant="secondary">
          {t("errors.goToToday")}
        </LinkButton>
      </div>
    </Card>
  );
}
