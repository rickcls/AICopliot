"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

/** The optional per-project layers, and the Project column each one sets. */
const SECTION_FIELD = {
  delivery: "deliveryEnabled",
  discovery: "discoveryEnabled",
} as const;

const LABEL_KEY = {
  delivery: { on: "project.toggle.deliveryOn", off: "project.toggle.deliveryOff" },
  discovery: { on: "project.toggle.discoveryOn", off: "project.toggle.discoveryOff" },
} as const;

export type ProjectSection = keyof typeof SECTION_FIELD;

/**
 * Turns one of a project's optional layers on or off — delivery (timeline,
 * risks, plan, reports) or discovery (requirements). Navigation only: the
 * records and their routes exist either way, so switching off hides nothing
 * permanently.
 */
export function SectionToggle({
  projectId,
  section,
  enabled,
  size = "sm",
  variant = "secondary",
}: {
  projectId: string;
  section: ProjectSection;
  enabled: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [SECTION_FIELD[section]]: !enabled }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error ?? t("project.toggle.failed"));
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={saving}
      onClick={() => void toggle()}
    >
      {t(enabled ? LABEL_KEY[section].off : LABEL_KEY[section].on)}
    </Button>
  );
}
