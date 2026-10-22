import { AuthShell } from "@/components/auth-shell";
import { getT } from "@/lib/i18n/server";
import { ResetPasswordForm } from "./reset-form";

export const metadata = { robots: { index: false, follow: false } };

/** Rendering this page does not change the password. Submitting the form does. */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT();

  return (
    <AuthShell appName={t("app.name")}>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
