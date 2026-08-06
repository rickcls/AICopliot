"use client";

import Link from "next/link";
import { Button, Card } from "@/components/ui";

/**
 * Failure boundary for signed-in pages without a nearer one. Without it a
 * failed query on the dashboard or documents page escapes to the global error
 * page, which replaces the whole shell — losing the navigation that lets
 * someone get somewhere that still works.
 *
 * The message stays generic because the underlying error may name internals.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h2 className="text-sm font-semibold text-slate-900">
        This page could not be loaded
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Something went wrong while loading it. Your data has not been changed.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-slate-400">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
        >
          Back to dashboard
        </Link>
      </div>
    </Card>
  );
}
