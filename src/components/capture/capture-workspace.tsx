"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CaptureBox } from "@/components/capture/capture-box";
import { CaptureCard, type ProjectOption } from "@/components/capture/capture-card";
import { useT } from "@/components/i18n-provider";
import type { CaptureView } from "@/lib/capture/view";

/**
 * The capture box with the notes beneath it. On /capture it lists recent
 * notes; on Today (`compact`) only notes that still have suggestions waiting,
 * plus a link to the rest — Today is for what needs doing, not for history.
 */
export function CaptureWorkspace({
  initialCaptures,
  projects,
  personalProjectId,
  compact = false,
}: {
  initialCaptures: CaptureView[];
  projects: ProjectOption[];
  personalProjectId: string;
  compact?: boolean;
}) {
  const t = useT();
  const [captures, setCaptures] = useState(initialCaptures);

  function replace(next: CaptureView) {
    setCaptures((current) => current.map((capture) => (capture.id === next.id ? next : capture)));
  }

  return (
    <div className="space-y-4">
      <CaptureBox
        personalProjectId={personalProjectId}
        onCaptured={(capture) => setCaptures((current) => [capture, ...current])}
      />

      {captures.map((capture) => (
        <CaptureCard
          key={capture.id}
          capture={capture}
          projects={projects}
          onChange={replace}
          onDelete={(id) => setCaptures((current) => current.filter((row) => row.id !== id))}
        />
      ))}

      {compact ? (
        <Link
          href="/capture"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          {t("capture.viewAll")}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : captures.length === 0 ? (
        <p className="text-sm text-slate-500">{t("capture.historyEmpty")}</p>
      ) : null}
    </div>
  );
}
