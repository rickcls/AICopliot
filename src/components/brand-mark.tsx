import { cn } from "@/lib/utils";

/**
 * The ScopePilot mark: a four-point star — a guiding star for a pilot, and the
 * sparkle that says an assistant is here — on a soft terracotta tile.
 *
 * The tile is `currentColor` and the star `fill-white`, so both follow the
 * palette remap: in the dark theme the tile turns light and the star dark,
 * keeping the mark legible without a second drawing. Decorative everywhere it
 * is used, because a link around it always carries the product name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      aria-hidden
      className={cn("size-7 shrink-0 text-brand-600", className)}
    >
      <rect width="28" height="28" rx="8" fill="currentColor" />
      <path
        className="fill-white"
        d="M14 5.5c.7 4.6 3.4 7.3 8.5 8.5-5.1 1.2-7.8 3.9-8.5 8.5-.7-4.6-3.4-7.3-8.5-8.5 5.1-1.2 7.8-3.9 8.5-8.5Z"
      />
    </svg>
  );
}
