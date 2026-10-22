import { AuthShell } from "@/components/auth-shell";
import { getT } from "@/lib/i18n/server";
import { ForgotPasswordForm } from "./forgot-form";

export const metadata = { robots: { index: false, follow: false } };

export default async function ForgotPasswordPage() {
  const t = await getT();

  return (
    <AuthShell appName={t("app.name")}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
