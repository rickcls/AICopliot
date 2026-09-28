"use client";

import "./globals.css";

/**
 * Last-resort boundary for a failure in the root layout itself. It replaces the
 * whole document, so it brings its own `<html>`, `<body>`, and stylesheet, and
 * uses no shared component that might be what failed.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 px-6 font-sans text-slate-900">
        <title>Something went wrong — ScopePilot</title>
        <main className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            ScopePilot could not load
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Something went wrong before the page could render. Your data has not
            been changed.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-slate-400">
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
