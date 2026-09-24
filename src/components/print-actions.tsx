"use client";

import { Download, Printer } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";

/** Screen-only controls above a printable pack. */
export function PrintActions({
  backHref,
  markdownHref,
}: {
  backHref: string;
  markdownHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <LinkButton href={backHref} variant="ghost" size="sm">
        ← Back to requirements
      </LinkButton>
      <span className="flex-1" />
      <LinkButton href={markdownHref} variant="secondary" size="sm" download>
        <Download className="size-3.5" aria-hidden />
        Markdown
      </LinkButton>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden />
        Print or save as PDF
      </Button>
    </div>
  );
}
