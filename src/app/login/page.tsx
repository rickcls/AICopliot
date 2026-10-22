import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-guard";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { getT } from "@/lib/i18n/server";
import { AuthShell } from "@/components/auth-shell";
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
    <AuthShell appName={t("app.name")}>
      <LoginForm
        callbackUrl={callbackUrl}
        initialMode={mode === "signup" ? "signup" : "signin"}
        invited={callbackUrl.startsWith("/invite/")}
      />
    </AuthShell>
  );
}
