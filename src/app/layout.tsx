import type { Metadata } from "next";
import { Geist_Mono, Source_Sans_3 } from "next/font/google";
import { I18nProvider } from "@/components/i18n-provider";
import { getLocale, getT } from "@/lib/i18n/server";
import { htmlLang } from "@/lib/i18n/locales";
import { getViewerTimeZone } from "@/lib/viewer";
import "./globals.css";

// Source Sans 3 reads more clearly in dense PM UI than Geist (the Next.js
// starter default), without tipping into a display face that fights the
// quiet metadata rows. It is Latin-only; globals.css names the CJK fallbacks.
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("app.name")} — ${t("app.tagline")}`,
    description: t("landing.lead"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved once here and handed to client components through context, so
  // the server render and hydration read the same language.
  const [locale, timeZone] = await Promise.all([getLocale(), getViewerTimeZone()]);

  return (
    // suppressHydrationWarning: the head script may set data-theme before
    // React hydrates, which is the point — it only silences this one element.
    <html
      lang={htmlLang(locale)}
      className={`${sourceSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies a saved light/dark choice before first paint. Without a
            saved choice the OS preference applies through CSS alone. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <I18nProvider locale={locale} timeZone={timeZone}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
