"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "scopepilot:theme";

/**
 * The choice lives on `<html data-theme>`, set before paint by the inline
 * script in the root layout, so the page never flashes the wrong theme. This
 * component only reads and writes that attribute; `useSyncExternalStore`
 * keeps the server render ("system") and the client in step without an
 * effect copying the DOM into state.
 */
function readChoice(): ThemeChoice {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private windows can refuse storage; the choice still holds for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const OPTIONS = [
  { value: "system", labelKey: "theme.system", Icon: Monitor },
  { value: "light", labelKey: "theme.light", Icon: Sun },
  { value: "dark", labelKey: "theme.dark", Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system");

  return (
    <div
      role="group"
      aria-label={t("theme.label")}
      className={cn(
        "inline-flex rounded-lg border border-sand-200 bg-sand-50 p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, labelKey, Icon }) => {
        const label = t(labelKey);
        return (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          title={label}
          onClick={() => applyChoice(value)}
          className={cn(
            "grid size-7 place-items-center rounded-md transition-colors",
            FOCUS_RING,
            choice === value
              ? "bg-white text-sand-900 shadow-sm"
              : "text-sand-400 hover:text-sand-900",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
        );
      })}
    </div>
  );
}
