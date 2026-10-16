"use client";

import { useState } from "react";
import { Inbox, Mail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Badge, Button, buttonClasses, Card, ErrorState, Spinner } from "@/components/ui";
import type { CaptureView } from "@/lib/capture/view";
import type { GmailListItem, GmailStatus } from "@/lib/gmail/service";

/**
 * Gmail on the Capture page: read-only, and only on request. "Check Gmail"
 * lists headers; "Suggest tasks" reads that one email in full and turns it
 * into a private capture, whose suggestions appear below like any other.
 */
export function GmailPanel({
  status,
  onCaptured,
}: {
  status: GmailStatus;
  onCaptured: (capture: CaptureView) => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<GmailListItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(status.needsReconnect);

  if (!status.configured) return null;

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const response = await fetch("/api/gmail/messages");
      const data = await response.json().catch(() => ({}));
      if (data.code === "reconnect") {
        setNeedsReconnect(true);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? t("gmail.failed"));
        return;
      }
      setMessages(data.messages);
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function capture(message: GmailListItem) {
    setBusy(message.id);
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${message.id}/capture`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.code === "reconnect") {
        setNeedsReconnect(true);
        return;
      }
      if (!response.ok || !data.capture) {
        setError(data.error ?? t("gmail.captureFailed"));
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
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Mail className="size-4 text-slate-400" aria-hidden />
            {t("gmail.title")}
            {status.connected && status.email ? (
              <span className="text-xs font-normal text-slate-500">{t("gmail.connectedAs", { email: status.email })}</span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {needsReconnect ? t("gmail.needsReconnect") : t("gmail.lead")}
          </p>
        </div>
        {!status.connected || needsReconnect ? (
          // A full navigation, not fetch: the OAuth flow leaves the site.
          <a href="/api/integrations/google/start" className={buttonClasses({ size: "sm" })}>
            {needsReconnect ? t("gmail.reconnect") : t("gmail.connect")}
          </a>
        ) : (
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void check()}>
            {busy === "check" ? <Spinner className="border-white/40 border-t-white" /> : <Inbox className="size-4" aria-hidden />}
            {busy === "check" ? t("gmail.checking") : t("gmail.check")}
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
          <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">{t("gmail.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{message.subject || "—"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {message.from}
                    {message.snippet ? <span className="text-slate-400"> · {message.snippet}</span> : null}
                  </p>
                </div>
                {message.captureId ? (
                  <Badge tone="success">{t("gmail.captured")}</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void capture(message)}
                  >
                    {busy === message.id ? <Spinner /> : null}
                    {busy === message.id ? t("gmail.capturing") : t("gmail.capture")}
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
