"use client";

import { useT } from "@/components/i18n-provider";

/**
 * "Loading" in the viewer's language for screen readers. Its own client
 * component so the shared primitives in `ui.tsx`, which server pages render
 * too, can announce a wait without becoming client code themselves.
 */
export function LoadingText() {
  const t = useT();
  return <span className="sr-only">{t("common.loading")}</span>;
}
