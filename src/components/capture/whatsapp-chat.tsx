"use client";

import { useId, useState } from "react";
import { MessageCircle, Sparkles } from "lucide-react";
import { useLocale, useT } from "@/components/i18n-provider";
import { Button, QUIET_CONTROL, Select, Spinner } from "@/components/ui";
import { intlLocale } from "@/lib/i18n/locales";
import { cn, formatDay } from "@/lib/utils";
import { buildChatCaptureBody, type ParsedChat } from "@/lib/whatsapp/parse";

type Range = "today" | "3d" | "7d" | "all";
const RANGES: Range[] = ["today", "3d", "7d", "all"];
const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { today: 0, "3d": 2, "7d": 6 };
const RANGE_KEY = {
  today: "capture.whatsappRangeToday",
  "3d": "capture.whatsappRange3d",
  "7d": "capture.whatsappRange7d",
  all: "capture.whatsappRangeAll",
} as const;

/** Your own WhatsApp name is the same in every chat, so it is remembered here. */
const ME_KEY = "scopepilot.whatsappMe";

function rememberedMe(participants: string[]): string {
  try {
    const name = window.localStorage.getItem(ME_KEY);
    return name && participants.includes(name) ? name : "";
  } catch {
    return "";
  }
}

/** The viewer's own calendar day, n days back, as YYYY-MM-DD. */
function localDay(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A WhatsApp chat recognised in the capture box. The person says which of the
 * names is them, so their own messages are marked 我, and how far back to read;
 * only that part is sent, as a capture of its own kind.
 */
export function WhatsAppChat({
  chat,
  busy,
  onSend,
  onUseAsText,
  onCancel,
}: {
  chat: ParsedChat;
  busy: string | null;
  onSend: (body: string) => void;
  onUseAsText: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const ids = useId();
  const [me, setMe] = useState(() => rememberedMe(chat.participants));
  const [range, setRange] = useState<Range>("3d");

  const fromDay = range === "all" ? null : localDay(RANGE_DAYS[range]);
  const inRange = chat.messages.filter((message) => !fromDay || message.at.slice(0, 10) >= fromDay).length;
  const dateLocale = intlLocale(locale);

  function send() {
    try {
      window.localStorage.setItem(ME_KEY, me);
    } catch {
      // Remembering the name is a convenience; the capture does not need it.
    }
    const { body } = buildChatCaptureBody(chat.messages, {
      me,
      fromDay,
      omittedNote: (count) => t("capture.whatsappOmitted", { count }),
    });
    onSend(body);
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-sand-900">
        <MessageCircle className="size-4 text-emerald-600" aria-hidden />
        {t("capture.whatsappDetected", {
          count: chat.messages.length,
          people: chat.participants.length,
          first: formatDay(chat.firstDay, dateLocale),
          last: formatDay(chat.lastDay, dateLocale),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={`${ids}-me`} className="flex items-center gap-2 text-xs text-sand-600">
          {t("capture.whatsappMe")}
          <Select
            id={`${ids}-me`}
            value={me}
            disabled={busy !== null}
            onChange={(event) => setMe(event.target.value)}
            className={cn(QUIET_CONTROL, "h-8 w-auto")}
          >
            <option value="">{t("capture.whatsappChooseMe")}</option>
            {chat.participants.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={`${ids}-range`} className="flex items-center gap-2 text-xs text-sand-600">
          {t("capture.whatsappRange")}
          <Select
            id={`${ids}-range`}
            value={range}
            disabled={busy !== null}
            onChange={(event) => setRange(event.target.value as Range)}
            className={cn(QUIET_CONTROL, "h-8 w-auto")}
          >
            {RANGES.map((option) => (
              <option key={option} value={option}>
                {t(RANGE_KEY[option])}
              </option>
            ))}
          </Select>
        </label>
        <span className="text-xs text-sand-500">
          {inRange > 0 ? t("capture.whatsappInRange", { count: inRange }) : t("capture.whatsappNoMessages")}
        </span>
      </div>

      <p className="text-xs text-sand-500">{t("capture.whatsappPrivacy")}</p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={onUseAsText}>
          {t("capture.whatsappAsText")}
        </Button>
        <Button type="button" disabled={busy !== null || !me || inRange === 0} onClick={send}>
          {busy ? <Spinner inverse /> : <Sparkles className="size-4" aria-hidden />}
          {busy ?? t("capture.submit")}
        </Button>
      </div>
    </div>
  );
}
