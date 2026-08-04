import { Card, Spinner } from "@/components/ui";

/** Covers every tab under /projects/[id] while its server page resolves. */
export default function ProjectTabLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner />
        Loading…
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-6 w-10 animate-pulse rounded bg-slate-200" />
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-4 w-full animate-pulse rounded bg-slate-100"
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
