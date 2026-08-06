"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete “${filename}”?`,
      body: "This also removes its indexed text, so it will no longer be available as evidence for answers.",
      confirmLabel: "Delete document",
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
      toast.success(`Deleted “${filename}”`);
      router.push("/documents");
      router.refresh();
    } else {
      setPending(false);
      toast.error("Could not delete that document.");
    }
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
