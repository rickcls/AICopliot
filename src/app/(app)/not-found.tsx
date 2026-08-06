import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * Reached when a signed-in page calls `notFound()` — most often a project,
 * document, or report ID that does not resolve.
 *
 * The wording avoids "does not exist": per `requireProject`, a record belonging
 * to another workspace deliberately 404s rather than 403s, and this page must
 * not undo that by confirming the ID is real.
 */
export default function AppNotFound() {
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="text-lg font-semibold text-slate-900">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        We could not find that page. It may have been deleted, or the link may
        be pointing somewhere you do not have access to.
      </p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href="/dashboard" className="text-slate-900 underline">
          Go to dashboard
        </Link>
        <Link href="/projects" className="text-slate-900 underline">
          Browse projects
        </Link>
      </div>
    </Card>
  );
}
