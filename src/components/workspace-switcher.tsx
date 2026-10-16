"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { QUIET_CONTROL, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface WorkspaceOption {
  id: string;
  name: string;
}

/**
 * Chooses which workspace the app acts in. Saved as the person's
 * `activeWorkspaceId`; the server checks membership on every request, so this
 * only ever selects among workspaces they already belong to.
 *
 * Switching lands on Today rather than reloading the current page: a project
 * open now belongs to the old workspace and would not resolve in the new one.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
  className,
}: {
  current: string;
  workspaces: WorkspaceOption[];
  className?: string;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);

  async function choose(workspaceId: string) {
    if (workspaceId === current) return;
    setSaving(true);
    try {
      const response = await fetch("/api/me/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) {
        toast.error(t("workspace.switchFailed"));
        return;
      }
      router.push("/today");
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {t("workspace.switchLabel")}
      </label>
      <Select
        id={id}
        value={current}
        disabled={saving}
        onChange={(event) => void choose(event.target.value)}
        className={cn(
          QUIET_CONTROL,
          "h-8 w-full max-w-full truncate px-1 text-xs font-medium",
        )}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
