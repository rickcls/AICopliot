"use client";

import { Download, Languages, Printer } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";

/**
 * Screen-only controls above a printable pack. The labels arrive from the
 * page, which knows the viewer's language even when the pack is in the other.
 */
export function PrintActions({
  backHref,
  markdownHref,
  otherLanguageHref,
  labels,
}: {
  backHref: string;
  markdownHref: string;
  otherLanguageHref: string;
  labels: { back: string; markdown: string; print: string; otherLanguage: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <LinkButton href={backHref} variant="ghost" size="sm">
        {labels.back}
      </LinkButton>
      <span className="flex-1" />
      <LinkButton href={otherLanguageHref} variant="ghost" size="sm">
        <Languages className="size-3.5" aria-hidden />
        {labels.otherLanguage}
      </LinkButton>
      <LinkButton href={markdownHref} variant="secondary" size="sm" download>
        <Download className="size-3.5" aria-hidden />
        {labels.markdown}
      </LinkButton>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden />
        {labels.print}
      </Button>
    </div>
  );
}
