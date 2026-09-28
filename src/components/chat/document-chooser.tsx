"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "@/components/modal";
import { Button, CHECKBOX, SearchField } from "@/components/ui";
import { MAX_FOCUS_DOCUMENTS } from "@/lib/schemas";

/**
 * Picks the documents a new thread answers from.
 *
 * A dialog rather than a multi-select `<select>`: a native multi-select needs a
 * modifier key to pick more than one, which almost nobody discovers, and it
 * cannot be searched. The list filters as you type because a project can hold
 * dozens of files with similar names.
 */
export function DocumentChooser({
  documents,
  initial,
  onCancel,
  onChoose,
}: {
  documents: Array<{ id: string; filename: string }>;
  initial: string[];
  onCancel: () => void;
  onChoose: (documentIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const [query, setQuery] = useState("");

  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? documents.filter((document) =>
        document.filename.toLocaleLowerCase().includes(needle),
      )
    : documents;
  const atLimit = selected.size >= MAX_FOCUS_DOCUMENTS;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_FOCUS_DOCUMENTS) next.add(id);
      return next;
    });
  }

  return (
    <Modal
      title="Ask about specific documents"
      description="Answers come only from the documents you tick. This starts a new thread."
      onClose={onCancel}
      className="max-w-lg"
    >
      <ModalBody className="space-y-3">
        <SearchField
          label="Filter documents"
          placeholder="Filter by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-autofocus
        />
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">There are no indexed documents here yet.</p>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto">
            {visible.map((document) => {
              const checked = selected.has(document.id);
              return (
                <li key={document.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      checked={checked}
                      disabled={!checked && atLimit}
                      onChange={() => toggle(document.id)}
                    />
                    <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 truncate">{document.filename}</span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-slate-500">No document matches.</li>
            ) : null}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="mr-auto text-xs text-slate-500">
          {selected.size} selected{atLimit ? ` (the limit is ${MAX_FOCUS_DOCUMENTS})` : ""}
        </span>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={selected.size === 0}
          onClick={() => onChoose([...selected])}
        >
          Ask about {selected.size === 1 ? "this document" : "these documents"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
