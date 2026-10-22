"use client";

import "./globals.css";

/**
 * Last-resort boundary for a failure in the root layout itself. It replaces the
 * whole document, so it brings its own `<html>`, `<body>`, and stylesheet, and
 * uses no shared component that might be what failed.
 *
 * Bilingual on purpose: the root layout is what resolves the viewer's
 * language, so when it fails there is no locale to read.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-Hant-HK">
      <body className="flex min-h-screen items-center justify-center bg-sand-50 px-6 font-sans text-sand-900">
        <title>出現問題 · Something went wrong — ScopePilot</title>
        <main className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight">ScopePilot 無法載入</h1>
          <p className="mt-2 text-sm text-sand-600">
            頁面顯示前出現問題，你的資料沒有任何改動。
          </p>
          <div lang="en" className="mt-4 border-t border-sand-200 pt-4">
            <h2 className="text-sm font-semibold">ScopePilot could not load</h2>
            <p className="mt-1 text-sm text-sand-600">
              Something went wrong before the page could render. Your data has not
              been changed.
            </p>
          </div>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-sand-400">
              參考編號 Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="mt-6 inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            再試一次 · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
