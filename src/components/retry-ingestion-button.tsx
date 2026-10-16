"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button, Spinner } from "@/components/ui";

/**
 * Re-runs ingestion for a failed document. runIngestion clears partial chunks
 * before retrying, so repeated clicks are safe.
 */
export function RetryIngestionButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRetry() {
    setPending(true);
    const processed = await fetch(`/api/documents/${id}/process`, { method: "POST" }).catch(
      () => null,
    );
    // A document that indexes on retry gets its filing labels as an upload does.
    if (processed?.ok) {
      await fetch(`/api/documents/${id}/label`, { method: "POST" }).catch(() => undefined);
    }
    setPending(false);
    router.refresh();
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleRetry} disabled={pending}>
      {pending ? <Spinner /> : null}
      {t("documents.retry")}
    </Button>
  );
}
