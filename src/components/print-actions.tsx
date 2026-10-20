"use client";

import { Download, Languages, Printer } from "lucide-react";
import { Button, LinkButton, buttonClasses } from "@/components/ui";

/**
 * Screen-only controls above a printable pack. The labels arrive from the
 * page, which knows the viewer's language even when the pack is in the other.
 *
 * The download is a plain `<a>`, not a `Link`: the router prefetched the
 * export route as if it were a page, which logged 400s and kept the page from
 * ever settling. The other two are real navigations and stay links.
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
      <a href={markdownHref} download className={buttonClasses({ variant: "secondary", size: "sm" })}>
        <Download className="size-3.5" aria-hidden />
        {labels.markdown}
      </a>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden />
        {labels.print}
      </Button>
    </div>
  );
}
