import * as React from "react";
import Link from "next/link";
import { LoadingText } from "@/components/loading-text";
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
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

/**
 * The same ring drawn inside the element, for links that fill a cell of a
 * clipped card (`StatGroup`, the overview panels): an offset ring there would
 * be cut off by the card's `overflow-hidden`.
 */
export const FOCUS_RING_INSET =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

/**
 * The class list behind `Button`, exported so a navigation that *looks* like a
 * button (`LinkButton`) cannot drift from one that *is* one. Fourteen links had
 * hand-copied these classes at three different heights.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    // A label never wraps inside a button: "新增工作" broke into two lines in a
    // narrow toolbar. The row around it wraps instead.
    "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors",
    FOCUS_RING,
    "disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "h-8 rounded-lg px-3 text-sm",
    size === "md" && "h-10 rounded-xl px-4 text-sm",
    size === "icon" && "size-8 shrink-0 rounded-lg p-0",
    variant === "primary" && "bg-brand-600 text-white shadow-xs hover:bg-brand-700",
    variant === "secondary" &&
      "border border-sand-200 bg-white text-sand-800 shadow-xs hover:border-sand-300 hover:bg-sand-50",
    variant === "ghost" && "text-sand-600 hover:bg-sand-100 hover:text-sand-900",
    variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button className={buttonClasses({ variant, size, className })} {...props} />
  );
}

/**
 * A real link styled as a button. Navigation stays an `<a>` so it can be opened
 * in a new tab and is announced as a link; only the paint is shared.
 */
export function LinkButton({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...props} />
  );
}

export function Input({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-sand-300 bg-white px-3 text-sm text-sand-900",
        "placeholder:text-sand-400 focus-visible:border-brand-500",
        FOCUS_RING,
        "disabled:cursor-not-allowed disabled:bg-sand-50",
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
        "w-full rounded-xl border border-sand-300 bg-white px-3 py-2 text-sm text-sand-900",
        "placeholder:text-sand-400 focus-visible:border-brand-500",
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
        "h-10 rounded-xl border border-sand-300 bg-white px-3 text-sm text-sand-900",
        "focus-visible:border-brand-500",
        FOCUS_RING,
        "disabled:cursor-not-allowed disabled:bg-sand-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A toggle chip in a filter bar. `aria-pressed` carries the state, so the
 * tinted fill is never the only signal.
 */
export function FilterChip({
  pressed,
  count,
  tone = "neutral",
  className,
  children,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  pressed: boolean;
  count?: number;
  /** `danger` draws an unpressed chip in red while its count is non-zero. */
  tone?: "neutral" | "danger";
}) {
  const alarming = tone === "danger" && (count ?? 0) > 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        FOCUS_RING,
        pressed
          ? alarming
            ? "border-red-700 bg-red-700 text-white"
            : "border-brand-200 bg-brand-50 text-brand-800"
          : alarming
            ? "border-red-200 bg-white text-red-700 hover:border-red-300"
            : "border-sand-200 bg-white text-sand-600 hover:border-sand-300 hover:text-sand-900",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            "tabular-nums",
            pressed ? (alarming ? "text-white/70" : "text-brand-700/70") : "text-sand-400",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A small set of mutually exclusive choices drawn as one control: theme,
 * language, board/list. A group of `aria-pressed` buttons rather than radios,
 * because each press acts at once instead of being submitted.
 *
 * Composed from `Segment`s rather than driven by an options array: the copies
 * this replaces put an icon, a language mark, or icon and text inside, and
 * some segments need their own `lang` or `title`.
 */
export function SegmentedControl({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-xl bg-sand-100 p-0.5", className)}
    >
      {children}
    </div>
  );
}

export function Segment({
  pressed,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium whitespace-nowrap transition-colors",
        FOCUS_RING,
        "disabled:pointer-events-none disabled:opacity-50",
        // The ring gives the pressed segment an edge in the dark theme, where
        // white and the track are only a step apart.
        pressed
          ? "bg-white text-sand-900 shadow-xs ring-1 ring-sand-200/80"
          : "text-sand-500 hover:text-sand-900",
        className,
      )}
      {...props}
    />
  );
}

/** A search box with a leading glyph. The label is required, and read aloud. */
export function SearchField({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: string }) {
  return (
    <div className={cn("relative", className)}>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sand-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <Input
        type="search"
        aria-label={label}
        className="h-8 pl-8 text-sm"
        {...props}
      />
    </div>
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
 * Task fields have since moved to pills (`property-pill.tsx`), where a value
 * needs to look changeable; this stays for secondary controls that should
 * recede — the chat composer's pickers, the capture box's language, the
 * workspace switcher.
 */
export const QUIET_CONTROL =
  // `w-auto`, not `w-full`: empty space belongs *beside* a short value, not
  // between the text and the chevron inside the control. Stretching every
  // select to `max-w-sm` made Assignee look like a wide empty bar while
  // Status/Priority (coloured) hug their labels — the jagged edge that made
  // the task form look broken.
  "w-auto max-w-sm border-transparent bg-transparent hover:bg-sand-100 focus-visible:border-brand-500 focus-visible:bg-white disabled:bg-transparent";

/**
 * Native checkboxes keep their platform rendering (and so their forced-colors
 * behaviour); this only aligns size, tint, and the focus ring with the rest of
 * the controls.
 */
export const CHECKBOX = `size-4 shrink-0 rounded border-sand-300 accent-brand-600 ${FOCUS_RING}`;

/** Fixed gutter for the leading icon on a quiet metadata row. */
export const ROW_ICON =
  "grid size-6 shrink-0 place-items-center text-sand-400";

export const ROW_LABEL = "text-xs font-medium text-sand-500";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-sand-200/70 bg-white shadow-soft",
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
  neutral: "bg-sand-100 text-sand-700 ring-1 ring-inset ring-sand-200",
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
 * The heading a page opens with: its one `h1`, a lead, and actions on the right.
 *
 * Pages wrote this by hand in ten slightly different ways — three spacings,
 * two lead colours, actions aligned three ways — which is a large part of why
 * moving between pages felt like moving between apps.
 */
export function PageHeader({
  title,
  lead,
  actions,
  className,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-sand-900 sm:text-3xl">
          {title}
        </h1>
        {lead ? (
          <div className="mt-2 max-w-2xl text-[15px] leading-relaxed text-sand-600">
            {lead}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
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
  icon,
  count,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** A small glyph before the title; decorative, so it is hidden from AT. */
  icon?: React.ReactNode;
  /** Shown as a quiet pill after the title rather than typed into it. */
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-sand-900">
          {icon ? (
            <span aria-hidden className="flex shrink-0">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0">{title}</span>
          {count !== undefined ? (
            <span className="rounded-full bg-sand-200/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-sand-600">
              {count}
            </span>
          ) : null}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-sand-500">{description}</p>
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
      <dt className="text-xs font-medium text-sand-500">{name}</dt>
      <dd className="min-w-0 text-sm text-sand-700">{children}</dd>
    </>
  );
}

/**
 * The two-column grid that `Field` pairs sit in. The label column width is the
 * only thing that varied between panels, so it is the only knob.
 */
export function DescriptionList({
  labelWidth = "7rem",
  className,
  children,
}: {
  labelWidth?: "7rem" | "8rem";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-2.5",
        labelWidth === "7rem"
          ? "sm:grid-cols-[7rem_minmax(0,1fr)]"
          : "sm:grid-cols-[8rem_minmax(0,1fr)]",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/**
 * A thin completion bar. The percentage is supplied rather than computed so
 * callers use `percentOf`, which never rounds onto an endpoint it has not
 * reached.
 */
export function ProgressBar({
  percent,
  label,
  className,
}: {
  percent: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 overflow-hidden rounded-full bg-sand-100", className)}
    >
      <div
        className="h-full rounded-full bg-emerald-500 transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * One headline number. A zero renders in the neutral colour whatever its tone —
 * "0 overdue" in red is an alarm for good news.
 */
export function StatCard({
  label,
  value,
  tone,
  href,
  hint,
  plain = false,
}: {
  label: string;
  value: number | string;
  tone?: "danger" | "warning" | "success";
  href?: string;
  hint?: React.ReactNode;
  /** A cell inside a `StatGroup` rather than a card of its own. */
  plain?: boolean;
}) {
  const alarming = typeof value === "number" ? value > 0 : true;
  const Frame = plain ? "div" : Card;
  const body = (
    <Frame
      className={cn(
        "h-full p-5",
        plain && "bg-white",
        href &&
          (plain
            ? "transition-colors group-hover:bg-sand-50"
            : "transition-colors group-hover:border-sand-300 group-hover:bg-sand-50"),
      )}
    >
      <p className="text-sm font-medium text-sand-500">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-3xl font-semibold tracking-tight tabular-nums text-sand-900",
          alarming && tone === "danger" && "text-red-700",
          alarming && tone === "warning" && "text-amber-700",
          alarming && tone === "success" && "text-emerald-700",
        )}
      >
        {value}
      </p>
      {hint ? <div className="mt-1.5 text-xs text-sand-500">{hint}</div> : null}
    </Frame>
  );

  return href ? (
    <Link
      href={href}
      className={cn("group block", plain ? FOCUS_RING_INSET : cn("rounded-2xl", FOCUS_RING))}
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Several headline numbers in one card, split by hairlines, instead of a card
 * each. The hairlines are the card's own fill showing through a `gap-px` grid,
 * so they stay right at every column count; each child paints itself white.
 * The caller sets the columns and must fill every cell, or the gap colour
 * shows through the empty one.
 */
export function StatGroup({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("grid gap-px overflow-hidden bg-sand-100", className)}>
      {children}
    </Card>
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
 * Colour derived from an identity rather than assigned at random, so the same
 * person — or project — is the same colour on every screen and in every list.
 * That consistency is what makes an avatar or a project mark scannable at all.
 */
const IDENTITY_TONES = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
] as const;

export function identityTone(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return IDENTITY_TONES[Math.abs(hash) % IDENTITY_TONES.length];
}

export function Avatar({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string;
  className?: string;
}) {
  return (
    <span
      title={name ?? email}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
        identityTone(email),
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}

export function Spinner({
  inverse = false,
  className,
}: {
  /** On a filled button: white on the fill, instead of brand on the page. */
  inverse?: boolean;
  className?: string;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2",
        inverse ? "border-white/40 border-t-white" : "border-sand-200 border-t-brand-600",
        className,
      )}
    >
      <LoadingText />
    </span>
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
      className={cn("animate-pulse rounded bg-sand-200", className)}
    />
  );
}

/** Wraps a set of `Skeleton`s so the wait is announced exactly once. */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy className={className}>
      {label ? <span className="sr-only">{label}</span> : <LoadingText />}
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description: string;
  /** A glyph in a soft brand circle above the title; decorative. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sand-300 bg-white/60 px-6 py-14 text-center">
      {icon ? (
        <span
          aria-hidden
          className="mb-4 grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600"
        >
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-sand-900">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-sand-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * A whole page's message when there is nothing else to show: a load failure, a
 * missing record. Centred, with a glyph in a tinted circle so it reads as the
 * app speaking rather than as a stray card. The error and not-found pages had
 * each set this up differently, at three heading sizes.
 */
export function MessagePanel({
  icon,
  tone = "brand",
  title,
  headingLevel = 2,
  actions,
  children,
}: {
  icon: React.ReactNode;
  /** `danger` for a failure; `brand` for a neutral "nothing here". */
  tone?: "brand" | "danger";
  title: string;
  headingLevel?: 1 | 2;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center">
      <span
        aria-hidden
        className={cn(
          "grid size-12 place-items-center rounded-full ring-1",
          tone === "danger"
            ? "bg-red-50 text-red-600 ring-red-100"
            : "bg-brand-50 text-brand-600 ring-brand-100",
        )}
      >
        {icon}
      </span>
      <Heading className="mt-4 text-lg font-semibold tracking-tight text-sand-900">
        {title}
      </Heading>
      {children ? (
        <div className="mt-1.5 max-w-md text-sm leading-relaxed text-sand-600">{children}</div>
      ) : null}
      {actions ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      ) : null}
    </Card>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </div>
  );
}
