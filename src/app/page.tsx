import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-guard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

const FEATURES: { title: MessageKey; body: MessageKey }[] = [
  { title: "landing.features.todayTitle", body: "landing.features.todayBody" },
  { title: "landing.features.citedTitle", body: "landing.features.citedBody" },
  { title: "landing.features.refuseTitle", body: "landing.features.refuseBody" },
  {
    title: "landing.features.isolationTitle",
    body: "landing.features.isolationBody",
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/today");

  const t = await getT();

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-sm font-semibold tracking-tight">
          {t("app.name")}
        </span>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
          >
            {t("landing.signIn")}
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-12 pb-16 text-center sm:pt-20">
        <p className="text-sm font-medium text-slate-500">
          {t("landing.eyebrow")}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t("landing.title")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-slate-600">
          {t("landing.lead")}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="w-full rounded-lg bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 sm:w-auto"
          >
            {t("landing.getStarted")}
          </Link>
          <Link
            href="/login"
            className="w-full rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium hover:bg-slate-50 sm:w-auto"
          >
            {t("landing.tryAssistant")}
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
              <h2 className="text-sm font-semibold">{t(feature.title)}</h2>
              <p className="mt-2 text-sm text-pretty text-slate-600">
                {t(feature.body)}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">
          {t("landing.footnote")}
        </p>
      </section>
    </main>
  );
}
