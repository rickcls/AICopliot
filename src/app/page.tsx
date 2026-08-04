import Link from "next/link";
import { getSessionUser } from "@/lib/auth-guard";

const FEATURES = [
  {
    title: "Grounded answers only",
    body: "Every response is generated from your uploaded documents. The model is given retrieved passages and nothing else.",
  },
  {
    title: "Verifiable citations",
    body: "Answers cite the filename, page or section, and a source excerpt, so you can check the original before acting on it.",
  },
  {
    title: "It says when it doesn't know",
    body: "When retrieval finds no strong evidence, the assistant refuses instead of inventing an answer.",
  },
  {
    title: "Workspace isolation",
    body: "Documents, chunks, and conversations are scoped to your workspace and enforced on every database read and write.",
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-sm font-semibold tracking-tight">
          AI Ops Copilot
        </span>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
            >
              Open workspace
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
            >
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-12 pb-16 text-center sm:pt-20">
        <p className="text-sm font-medium text-slate-500">
          Internal knowledge assistant for IT operations
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Answers from your runbooks, not from guesswork
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-slate-600">
          Upload your operational documents, ask a question in plain English,
          and get an answer assembled only from what those documents actually
          say — with citations you can open and verify.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={user ? "/dashboard" : "/login"}
            className="w-full rounded-lg bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 sm:w-auto"
          >
            {user ? "Go to dashboard" : "Get started"}
          </Link>
          <Link
            href={user ? "/chat" : "/login"}
            className="w-full rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium hover:bg-slate-50 sm:w-auto"
          >
            Try the assistant
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-sm font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm text-pretty text-slate-600">
                {feature.body}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">
          Retrieval-augmented search over your own documents. It answers
          questions — it does not take actions on external systems.
        </p>
      </section>
    </main>
  );
}
