"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Modal, ModalBody, ModalFooter } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Input, Spinner } from "@/components/ui";

/**
 * Renames a document. The name is `Document.title`, which every screen shows
 * through `documentName()`, so a rename reads the same in the list, a task's
 * documents, its sources, and chat. The file's own name is kept and shown
 * beside it; clearing the field goes back to it. A rename is the person's
 * label, so a later AI pass will not rename it again.
 */
export function RenameDocumentButton({
  id,
  title,
  originalFilename,
  variant = "secondary",
  onRenamed,
}: {
  id: string;
  title: string | null;
  originalFilename: string;
  variant?: "secondary" | "ghost";
  /** Updates a list in place; without it the page is refreshed. */
  onRenamed?: (title: string | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = draft.trim() || null;
    if (next === (title ?? null)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!response.ok) {
        toast.error(t("documents.renameFailed"));
        return;
      }
      setOpen(false);
      toast.success(t("documents.renamed", { name: next ?? originalFilename }));
      if (onRenamed) onRenamed(next);
      else router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={() => {
          setDraft(title ?? "");
          setOpen(true);
        }}
      >
        <Pencil className="size-3.5" aria-hidden />
        {t("documents.rename")}
      </Button>
      {open ? (
        <Modal
          title={t("documents.renameTitle")}
          description={t("documents.renameFile", { name: originalFilename })}
          onClose={() => setOpen(false)}
          className="max-w-md"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ModalBody>
              <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-sand-700">
                {t("documents.renameLabel")}
              </label>
              <Input
                id={inputId}
                data-autofocus
                value={draft}
                maxLength={120}
                placeholder={originalFilename}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="mt-1.5 text-xs text-sand-500">{t("documents.renameHint")}</p>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner inverse /> : null}
                {t("documents.renameSave")}
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
