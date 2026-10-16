"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

export function DeleteDocumentButton({
  id,
  filename,
}: {
  id: string;
  filename: string;
}) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    const confirmed = await confirm({
      title: t("documents.deleteTitle", { name: filename }),
      body: t("documents.deleteBody"),
      confirmLabel: t("documents.delete"),
      tone: "danger",
    });
    if (!confirmed) return;

    setPending(true);
    const response = await fetch(`/api/documents/${id}`, {
      method: "DELETE",
    }).catch(() => null);

    if (response?.ok) {
      // Navigating away unmounts this component, so the confirmation has to
      // come from the provider above it rather than from local state.
      toast.success(t("documents.deleted", { name: filename }));
      router.push("/documents");
      router.refresh();
    } else {
      setPending(false);
      toast.error(t("documents.deleteFailed"));
    }
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
      {t("documents.delete")}
    </Button>
  );
}
