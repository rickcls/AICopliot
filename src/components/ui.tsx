import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small shadcn/ui-style primitives, hand-rolled to keep the dependency surface
 * minimal. Same composition model (className-merging, variant props) so the
 * shadcn CLI can drop in richer components later without churn.
 */

/**
 * One focus treatment for every interactive control, so keyboard position is
 * equally legible on a button, a field, and a dialog.
 *
 * `outline-hidden` rather than `outline-none`: it leaves a transparent outline
 * behind, which Windows High Contrast Mode repaints. A `ring` is a box-shadow
 * and forced-colors mode discards it, so `outline-none` would leave those users
 * with no focus indicator at all.
 */
export const FOCUS_RING =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        FOCUS_RING,
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "icon" && "size-8 shrink-0 p-0",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-700",
        variant === "secondary" &&
          "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900",
        "placeholder:text-slate-400 focus-visible:border-slate-900",
        FOCUS_RING,
        "disabled:cursor-not-allowed disabled:bg-slate-50",
        className,
      )}
      {...props}
    />
  );
}

// `ComponentProps` rather than `TextareaHTMLAttributes` so `ref` is accepted as
// an ordinary prop — the chat composer needs one to auto-grow the field.
export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900",
        "placeholder:text-slate-400 focus-visible:border-slate-900",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900",
        "focus-visible:border-slate-900",
        FOCUS_RING,
        "disabled:cursor-not-allowed disabled:bg-slate-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Metadata reads as quiet label/value rows rather than a grid of boxed inputs.
 *
 * Every control used to carry a permanent border and white fill, so a form with
 * seven of them read as seven competing objects and the description — the only
 * field that needs room to think in — was the smallest thing on screen. Here the
 * chrome only appears on hover and focus, so at rest the block reads as a short
 * list of facts, and the description gets the space.
 *
 * Lives here rather than in `task-form.tsx` because the task detail panel and
 * the chat composer use it too, and importing a style constant *through* an
 * unrelated form component is the same drift `SectionHeader` was extracted to fix.
 */
export const QUIET_CONTROL =
  // `w-auto`, not `w-full`: empty space belongs *beside* a short value, not
  // between the text and the chevron inside the control. Stretching every
  // select to `max-w-sm` made Assignee look like a wide empty bar while
  // Status/Priority (coloured) hug their labels — the jagged edge that made
  // the task form look broken.
  "w-auto max-w-sm border-transparent bg-transparent hover:bg-slate-100 focus-visible:border-slate-900 focus-visible:bg-white disabled:bg-transparent";

/** Fixed gutter for the leading icon on a quiet metadata row. */
export const ROW_ICON =
  "grid size-6 shrink-0 place-items-center text-slate-400";

export const ROW_LABEL = "text-xs font-medium text-slate-500";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A pale fill alone gives a badge almost no edge against a white row, so each
 * tone carries an inset ring as well. It is `ring-inset` rather than a border so
 * adding it never changes the badge's size, and so a badge can sit in a tight
 * row without nudging its neighbours.
 */
const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  info: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/70",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70",
  danger: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/70",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * The title/description/actions row every panel opens with.
 *
 * Extracted because each panel had grown its own near-identical version, and
 * they had drifted: some used `text-sm font-medium`, some `text-sm font-semibold`,
 * and the description sat at three different sizes. A section heading that
 * changes weight between tabs makes the app read as several apps.
 */
export function SectionHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * One label/value pair inside a two-column `<dl>`.
 *
 * A fragment rather than a wrapping element on purpose: the grid columns live
 * on the `<dl>`, and any wrapper here would make each pair a single grid cell
 * and collapse the two columns back into one.
 */
export function Field({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs font-medium text-slate-500">{name}</dt>
      <dd className="min-w-0 text-sm text-slate-700">{children}</dd>
    </>
  );
}

/**
 * Initials for an avatar chip, falling back to the local part of the email so a
 * member who never set a name still gets something stable rather than "?".
 */
function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/**
 * Small circular avatar. Colour is derived from the identity rather than
 * assigned at random, so the same person is the same colour on every screen and
 * in every list — that consistency is what makes an avatar scannable at all.
 */
const AVATAR_TONES = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
] as const;

export function Avatar({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string;
  className?: string;
}) {
  let hash = 0;
  for (const character of email) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];

  return (
    <span
      title={name ?? email}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
        tone,
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900",
        className,
      )}
    />
  );
}

/**
 * A shape standing in for content that has not arrived. Sized by the caller,
 * because a placeholder is only reassuring if it matches what replaces it.
 *
 * Purely decorative: announce the wait once on the surrounding region rather
 * than letting a screen reader enumerate a dozen empty boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-slate-200", className)}
    />
  );
}

/** Wraps a set of `Skeleton`s so the wait is announced exactly once. */
export function SkeletonRegion({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </div>
  );
}
