import { Card, Skeleton, SkeletonRegion } from "@/components/ui";

/** The board is columns, not a list, so it gets its own placeholder. */
export default function TasksLoading() {
  return (
    <SkeletonRegion label="Loading tasks" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-40 bg-slate-100" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[3, 2, 2, 1, 2].map((cards, column) => (
          <div key={column} className="space-y-2 rounded-xl bg-slate-100/70 p-2">
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: cards }, (_, index) => (
              <Card key={index} className="space-y-2 p-3">
                <Skeleton className="h-4 w-full bg-slate-100" />
                <Skeleton className="h-3 w-1/2 bg-slate-100" />
              </Card>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
