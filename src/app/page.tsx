import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, Lock, Quote, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Card, FOCUS_RING, LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth-guard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

const FEATURES: {
  title: MessageKey;
  body: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { title: "landing.features.todayTitle", body: "landing.features.todayBody", icon: CalendarCheck },
  { title: "landing.features.citedTitle", body: "landing.features.citedBody", icon: Quote },
  { title: "landing.features.refuseTitle", body: "landing.features.refuseBody", icon: ShieldCheck },
  {
    title: "landing.features.isolationTitle",
    body: "landing.features.isolationBody",
    icon: Lock,
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/today");

  const t = await getT();

  return (
    // A soft terracotta wash at the top, fading into the page: the one place
    // the brand fills an area, because this page is the first impression.
    <main className="flex-1 bg-linear-to-b from-brand-50/80 via-sand-50 to-sand-50">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className={cn("flex items-center gap-2.5 rounded-lg", FOCUS_RING)}
        >
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight">{t("app.name")}</span>
        </Link>
        <LinkButton href="/login" variant="secondary" size="sm">
          {t("landing.signIn")}
        </LinkButton>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-12 pb-16 text-center sm:pt-20">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-brand-700 shadow-xs ring-1 ring-brand-200/70">
          <BrandMark className="size-4 rounded-sm" />
          {t("landing.eyebrow")}
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-sand-900 sm:text-6xl">
          {t("landing.title")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-sand-600">
          {t("landing.lead")}
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LinkButton href="/login?mode=signup" className="h-11 w-full px-6 sm:w-auto">
            {t("landing.getStarted")}
          </LinkButton>
          <LinkButton href="/login" variant="secondary" className="h-11 w-full px-6 sm:w-auto">
            {t("landing.tryAssistant")}
          </LinkButton>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="p-6">
                <span
                  aria-hidden
                  className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"
                >
                  <Icon className="size-5" />
                </span>
                <h2 className="mt-4 text-base font-semibold text-sand-900">{t(feature.title)}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-pretty text-sand-600">
                  {t(feature.body)}
                </p>
              </Card>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-sand-500">
          {t("landing.footnote")}
        </p>
      </section>
    </main>
  );
}
