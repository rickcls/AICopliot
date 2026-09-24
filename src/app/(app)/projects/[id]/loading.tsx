import { Card, Skeleton, SkeletonRegion } from "@/components/ui";

/**
 * Covers every tab under /projects/[id] while its server page resolves.
 *
 * Shaped like a section header over a one-line-per-record list, because that is
 * what most tabs are. It used to draw a four-card stat row that only the
 * Overview has, so every other tab flashed a layout it would never show.
 */
export default function ProjectTabLoading() {
  return (
    <SkeletonRegion className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-64 max-w-full bg-slate-100" />
      </div>
      <Card className="divide-y divide-slate-100">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-4 w-14 bg-slate-100" />
            <Skeleton className="h-4 flex-1 bg-slate-100" />
            <Skeleton className="h-4 w-16 bg-slate-100" />
          </div>
        ))}
      </Card>
    </SkeletonRegion>
  );
}
