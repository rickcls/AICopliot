import { LinkButton } from "@/components/ui";

/**
 * Unmatched URLs, which may well be reached by someone who is not signed in —
 * so this renders in the bare root layout with no sidebar and links only to
 * public destinations.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        This page does not exist
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        Check the address, or head back and navigate from there.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">Back to home</LinkButton>
        <LinkButton href="/dashboard" variant="secondary">
          Go to dashboard
        </LinkButton>
      </div>
    </main>
  );
}
