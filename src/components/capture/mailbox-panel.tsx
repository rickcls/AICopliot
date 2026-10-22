"use client";

import { useState } from "react";
import { Inbox, Mail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Badge, Button, buttonClasses, Card, ErrorState, Spinner } from "@/components/ui";
import type { CaptureView } from "@/lib/capture/view";
import {
  MAILBOX_ROUTES,
  type MailboxKind,
  type MailboxStatus,
  type MailListItem,
} from "@/lib/mail/mailboxes";

/**
 * A mailbox on the Capture page — Gmail or Outlook — read-only, and only on
 * request. "Check" lists headers; "Suggest tasks" reads that one email in full
 * and turns it into a private capture, whose suggestions appear below like any
 * other. Not shown at all when the server has no app registered for it.
 */
export function MailboxPanel({
  kind,
  status,
  onCaptured,
}: {
  kind: MailboxKind;
  status: MailboxStatus;
  onCaptured: (capture: CaptureView) => void;
}) {
  const t = useT();
  const routes = MAILBOX_ROUTES[kind];
  const [messages, setMessages] = useState<MailListItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(status.needsReconnect);

  if (!status.configured) return null;

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const response = await fetch(routes.list);
      const data = await response.json().catch(() => ({}));
      if (data.code === "reconnect") {
        setNeedsReconnect(true);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? t(`${kind}.failed`));
        return;
      }
      setMessages(data.messages);
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function capture(message: MailListItem) {
    setBusy(message.id);
    setError(null);
    try {
      const response = await fetch(routes.capture(message.id), { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.code === "reconnect") {
        setNeedsReconnect(true);
        return;
      }
      if (!response.ok || !data.capture) {
        setError(data.error ?? t(`${kind}.captureFailed`));
        return;
      }
      onCaptured(data.capture as CaptureView);
      setMessages((list) =>
        (list ?? []).map((item) => (item.id === message.id ? { ...item, captureId: data.capture.id } : item)),
      );
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-sand-900">
            <Mail className="size-4 text-sand-400" aria-hidden />
            {t(`${kind}.title`)}
            {status.connected && status.email ? (
              <span className="text-xs font-normal text-sand-500">
                {t(`${kind}.connectedAs`, { email: status.email })}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-sand-500">
            {needsReconnect ? t(`${kind}.needsReconnect`) : t(`${kind}.lead`)}
          </p>
        </div>
        {!status.connected || needsReconnect ? (
          // A full navigation, not fetch: the OAuth flow leaves the site.
          <a href={routes.start} className={buttonClasses({ size: "sm" })}>
            {needsReconnect ? t(`${kind}.reconnect`) : t(`${kind}.connect`)}
          </a>
        ) : (
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void check()}>
            {busy === "check" ? <Spinner className="border-white/40 border-t-white" /> : <Inbox className="size-4" aria-hidden />}
            {busy === "check" ? t(`${kind}.checking`) : t(`${kind}.check`)}
          </Button>
        )}
      </div>

      {error ? (
        <div className="px-4 pb-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      {messages ? (
        messages.length === 0 ? (
          <p className="border-t border-sand-100 px-4 py-3 text-sm text-sand-500">{t(`${kind}.empty`)}</p>
        ) : (
          <ul className="divide-y divide-sand-100 border-t border-sand-100">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-sand-900">{message.subject || "—"}</p>
                  <p className="truncate text-xs text-sand-500">
                    {message.from}
                    {message.snippet ? <span className="text-sand-400"> · {message.snippet}</span> : null}
                  </p>
                </div>
                {message.captureId ? (
                  <Badge tone="success">{t(`${kind}.captured`)}</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void capture(message)}
                  >
                    {busy === message.id ? <Spinner /> : null}
                    {busy === message.id ? t(`${kind}.capturing`) : t(`${kind}.capture`)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Card>
  );
}
