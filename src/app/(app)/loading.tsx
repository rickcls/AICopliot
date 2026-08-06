import { Card, Skeleton, SkeletonRegion } from "@/components/ui";

/**
 * Covers every signed-in page that has no closer boundary — dashboard,
 * projects, documents, chat, evaluations. `/projects/[id]` has its own, which
 * takes precedence because it is nearer.
 *
 * Deliberately generic: it stands in for a page heading and one content block,
 * which every page here begins with. A skeleton that guessed at each page's
 * particular layout would shift more than it settles.
 */
export default function AppLoading() {
  return (
    <SkeletonRegion className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full bg-slate-100" />
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full bg-slate-100" />
          <Skeleton className="h-4 w-11/12 bg-slate-100" />
          <Skeleton className="h-4 w-4/5 bg-slate-100" />
        </div>
      </Card>
    </SkeletonRegion>
  );
}
