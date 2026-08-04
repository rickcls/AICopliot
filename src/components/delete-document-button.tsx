"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function DeleteDocumentButton({
  id,
  filename,
}: {
  id: string;
  filename: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${filename}"? This also removes its indexed text.`)) {
      return;
    }

    setPending(true);
    const response = await fetch(`/api/documents/${id}`, {
      method: "DELETE",
    }).catch(() => null);

    if (response?.ok) {
      router.push("/documents");
      router.refresh();
    } else {
      setPending(false);
      alert("Could not delete that document.");
    }
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
