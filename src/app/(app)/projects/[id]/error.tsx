"use client";

import { useT } from "@/components/i18n-provider";
import { CircleAlert } from "lucide-react";
import { Button, LinkButton, MessagePanel } from "@/components/ui";

/**
 * Failure boundary for the project tabs. A missing or foreign project reaches
 * notFound() instead, so this covers genuine faults — the message stays generic
 * because the underlying error may name internals.
 */
export default function ProjectTabError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useT();
  return (
    <MessagePanel
      tone="danger"
      icon={<CircleAlert className="size-6" />}
      title={t("errors.sectionFailedTitle")}
      actions={
        <>
          <Button type="button" onClick={retry}>
            {t("errors.tryAgain")}
          </Button>
          <LinkButton href="/projects" variant="secondary">
            {t("errors.backToProjects")}
          </LinkButton>
        </>
      }
    >
      <p>{t("errors.sectionFailedBody")}</p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-sand-400">
          {t("errors.reference", { digest: error.digest })}
        </p>
      ) : null}
    </MessagePanel>
  );
}
