import { useT } from "@/components/i18n-provider";
import type { TaskPriority } from "@/components/task-types";
import { cn } from "@/lib/utils";

/**
 * How a task's priority is drawn everywhere: a shape, a colour, and the word.
 *
 * It was a small coloured flag, which people did not notice — four flags that
 * differ only in hue read as one icon at a glance. Now the shape carries the
 * level on its own (one, two, or three signal bars; urgent is a filled square
 * with "!"), the colour repeats it, and the word removes any doubt, so it
 * survives a colour-blind viewer and a dark theme alike.
 *
 * Urgent is the only solid fill: it is the level that must stand out on a
 * board of otherwise tinted badges. 600 rather than 500, because a fill that
 * carries white text must not be the one shade the dark remap leaves in place.
 */

/** Badge tints, shared with the priority control in the task panel. */
export const PRIORITY_TONE: Record<TaskPriority, string> = {
  urgent: "bg-red-600 text-white ring-red-600",
  high: "bg-orange-50 text-orange-700 ring-orange-200/80",
  medium: "bg-blue-50 text-blue-700 ring-blue-200/70",
  low: "bg-sand-100 text-sand-500 ring-sand-200",
};

const BARS: Record<Exclude<TaskPriority, "urgent">, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** The shape alone. `currentColor` paints it; decorative wherever it is used. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5 shrink-0", className)}>
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
        {/* The mark is cut out of the square in the badge's own fill, so it
            reads on the solid badge and on a light background alike. */}
        <rect x="7" y="3.5" width="2" height="6" rx="1" className="fill-red-600" />
        <circle cx="8" cy="12" r="1.15" className="fill-red-600" />
      </svg>
    );
  }
  const lit = BARS[priority];
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5 shrink-0", className)}>
      {[
        { x: 1.5, y: 9, height: 5.5 },
        { x: 6.5, y: 5.5, height: 9 },
        { x: 11.5, y: 2, height: 12.5 },
      ].map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3"
          height={bar.height}
          rx="1"
          fill="currentColor"
          opacity={index < lit ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const t = useT();
  const label = t(`priority.${priority}`);
  return (
    <span
      title={t("priority.flag", { level: label })}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        PRIORITY_TONE[priority],
        className,
      )}
    >
      <PriorityIcon priority={priority} className={priority === "urgent" ? "text-white" : undefined} />
      {label}
    </span>
  );
}
