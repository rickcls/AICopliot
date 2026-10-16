import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-guard";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; mode?: string }>;
}) {
  const { callbackUrl: requested, mode } = await searchParams;
  // Validated here, once, so the form can only ever navigate within the site.
  const callbackUrl = safeCallbackUrl(requested);

  const user = await getSessionUser();
  if (user) redirect(callbackUrl);

  const t = await getT();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-sm font-semibold tracking-tight"
        >
          {t("app.name")}
        </Link>
        <LoginForm
          callbackUrl={callbackUrl}
          initialMode={mode === "signup" ? "signup" : "signin"}
          invited={callbackUrl.startsWith("/invite/")}
        />
      </div>
    </main>
  );
}
