"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Button, buttonClasses, Card, SectionHeader } from "@/components/ui";
import type { GmailStatus } from "@/lib/gmail/service";

/** Settings' view of read-only outside accounts. Today, Gmail only. */
export function ConnectedAccounts({ gmail }: { gmail: GmailStatus }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/google", { method: "DELETE" });
      if (response.ok) {
        toast.success(t("gmail.disconnected"));
        router.refresh();
      } else {
        toast.error(t("common.couldNotReach"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeader title={t("gmail.accountsTitle")} description={t("gmail.accountsLead")} />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Mail className="size-4 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{t("gmail.title")}</p>
            <p className="truncate text-xs text-slate-500">
              {!gmail.configured
                ? t("gmail.notConfigured")
                : gmail.connected && gmail.email
                  ? gmail.needsReconnect
                    ? t("gmail.needsReconnect")
                    : t("gmail.connectedAs", { email: gmail.email })
                  : t("gmail.notConnected")}
            </p>
          </div>
        </div>
        {gmail.configured ? (
          <div className="flex gap-2">
            {!gmail.connected || gmail.needsReconnect ? (
              <a href="/api/integrations/google/start" className={buttonClasses({ size: "sm" })}>
                {gmail.needsReconnect ? t("gmail.reconnect") : t("gmail.connect")}
              </a>
            ) : null}
            {gmail.connected ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
                {t("gmail.disconnect")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
