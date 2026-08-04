"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Spinner } from "@/components/ui";

/**
 * Re-runs ingestion for a failed document. runIngestion clears partial chunks
 * before retrying, so repeated clicks are safe.
 */
export function RetryIngestionButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRetry() {
    setPending(true);
    await fetch(`/api/documents/${id}/process`, { method: "POST" }).catch(
      () => undefined,
    );
    setPending(false);
    router.refresh();
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleRetry} disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Retrying…
        </>
      ) : (
        "Retry"
      )}
    </Button>
  );
}
