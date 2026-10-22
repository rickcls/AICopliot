"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Button, buttonClasses, Card, SectionHeader } from "@/components/ui";
import { MAILBOX_ROUTES, type MailboxKind, type MailboxStatus } from "@/lib/mail/mailboxes";

/** Settings' view of the read-only mailboxes: Gmail and Outlook. */
export function ConnectedAccounts({ gmail, outlook }: { gmail: MailboxStatus; outlook: MailboxStatus }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <SectionHeader title={t("gmail.accountsTitle")} description={t("gmail.accountsLead")} />
      <MailboxRow kind="gmail" status={gmail} />
      <MailboxRow kind="outlook" status={outlook} />
    </section>
  );
}

function MailboxRow({ kind, status }: { kind: MailboxKind; status: MailboxStatus }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const routes = MAILBOX_ROUTES[kind];

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch(routes.account, { method: "DELETE" });
      if (response.ok) {
        toast.success(t(`${kind}.disconnected`));
        router.refresh();
      } else {
        toast.error(t("common.couldNotReach"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Mail className="size-4 shrink-0 text-sand-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-sand-900">{t(`${kind}.title`)}</p>
          <p className="truncate text-xs text-sand-500">
            {!status.configured
              ? t(`${kind}.notConfigured`)
              : status.connected && status.email
                ? status.needsReconnect
                  ? t(`${kind}.needsReconnect`)
                  : t(`${kind}.connectedAs`, { email: status.email })
                : t(`${kind}.notConnected`)}
          </p>
        </div>
      </div>
      {status.configured ? (
        <div className="flex gap-2">
          {!status.connected || status.needsReconnect ? (
            <a href={routes.start} className={buttonClasses({ size: "sm" })}>
              {status.needsReconnect ? t(`${kind}.reconnect`) : t(`${kind}.connect`)}
            </a>
          ) : null}
          {status.connected ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
              {t(`${kind}.disconnect`)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
