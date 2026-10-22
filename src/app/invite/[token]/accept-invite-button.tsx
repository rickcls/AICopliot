"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { Button, ErrorState, Spinner } from "@/components/ui";

/**
 * Accepts the invite, then opens Today in the joined workspace. Acceptance is
 * a POST rather than something the page does on load, so merely opening a
 * link — a mail client's link preview, say — never joins anyone.
 */
export function AcceptInviteButton({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setError(t("invite.acceptFailed"));
        // The server's view of the link may have changed (used, withdrawn);
        // re-render so the page states it.
        router.refresh();
        return;
      }
      router.push("/today");
      router.refresh();
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState message={error} /> : null}
      <Button type="button" className="w-full" disabled={pending} onClick={() => void accept()}>
        {pending ? <Spinner inverse /> : null}
        {label}
      </Button>
    </div>
  );
}
