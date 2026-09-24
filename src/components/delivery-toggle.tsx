"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

/**
 * Turns a project's delivery tabs on or off. Navigation only: the records and
 * their routes exist either way, so switching off hides nothing permanently.
 */
export function DeliveryToggle({
  projectId,
  enabled,
  size = "sm",
  variant = "secondary",
}: {
  projectId: string;
  enabled: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryEnabled: !enabled }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error ?? "Could not change delivery tools.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
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
      {enabled ? "Turn off delivery tools" : "Turn on delivery tools"}
    </Button>
  );
}
