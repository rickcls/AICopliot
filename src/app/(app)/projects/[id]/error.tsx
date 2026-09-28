"use client";

import { Button, Card, LinkButton } from "@/components/ui";

/**
 * Failure boundary for the project tabs. A missing or foreign project reaches
 * notFound() instead, so this covers genuine faults — the message stays generic
 * because the underlying error may name internals.
 */
export default function ProjectTabError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">
        This section could not be loaded
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Something went wrong while loading this project. Your data has not been
        changed.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-slate-400">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={retry}>
          Try again
        </Button>
        <LinkButton href="/projects" variant="secondary">
          Back to projects
        </LinkButton>
      </div>
    </Card>
  );
}
