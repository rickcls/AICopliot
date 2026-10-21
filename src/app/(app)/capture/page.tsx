import { CaptureWorkspace } from "@/components/capture/capture-workspace";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCaptureProjectOptions, listCaptures } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";
import { getGmailStatus } from "@/lib/gmail/service";
import { adminConsentUrl } from "@/lib/outlook/oauth";
import { getOutlookStatus, outlookConfig } from "@/lib/outlook/service";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Every note the person has captured, newest first, with its suggestions. */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string; outlook?: string }>;
}) {
  const access = await requireWorkspace();
  const { gmail: gmailOutcome, outlook: outlookOutcome } = await searchParams;
  const [t, captures, options, gmail, outlook] = await Promise.all([
    getT(),
    listCaptures(access, { limit: 20 }),
    getCaptureProjectOptions(access),
    getGmailStatus(access.userId),
    getOutlookStatus(access.userId),
  ]);
  // An OAuth callback lands here with its outcome in the query string.
  const kind = outlookOutcome ? "outlook" : "gmail";
  const outcome = outlookOutcome ?? gmailOutcome;
  const notice =
    outcome === "connected"
      ? { tone: "ok", text: t(`${kind}.connectedNotice`) }
      : outcome === "error"
        ? { tone: "error", text: t(`${kind}.errorNotice`) }
        : outcome === "not_configured"
          ? { tone: "error", text: t(`${kind}.notConfigured`) }
          : null;
  // A company that has not approved the app: the link is what to send IT.
  const config = outlookOutcome === "needs_admin" ? outlookConfig() : null;
  const adminLink = config ? adminConsentUrl(config.clientId) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("capture.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("capture.lead")}</p>
      </div>
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === "ok"
              ? "mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
              : "mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
          }
        >
          {notice.text}
        </p>
      ) : null}
      {adminLink ? (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>{t("outlook.needsAdminNotice")}</p>
          <a href={adminLink} className="mt-1 inline-block break-all font-medium underline" target="_blank" rel="noopener noreferrer">
            {t("outlook.adminLink")}
          </a>
        </div>
      ) : null}
      <CaptureWorkspace
        initialCaptures={captures.map(toCaptureView)}
        projects={options.projects}
        colleagues={options.colleagues}
        personalProjectId={options.personalProjectId}
        gmail={gmail}
        outlook={outlook}
      />
    </div>
  );
}
