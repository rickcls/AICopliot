import { Card, Skeleton, SkeletonRegion } from "@/components/ui";

/** Covers every tab under /projects/[id] while its server page resolves. */
export default function ProjectTabLoading() {
  return (
    <SkeletonRegion className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-10" />
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-4 w-full bg-slate-100" />
          ))}
        </div>
      </Card>
    </SkeletonRegion>
  );
}
