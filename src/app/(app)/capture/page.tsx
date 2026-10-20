import { CaptureWorkspace } from "@/components/capture/capture-workspace";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCaptureProjectOptions, listCaptures } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";
import { getGmailStatus } from "@/lib/gmail/service";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Every note the person has captured, newest first, with its suggestions. */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const access = await requireWorkspace();
  const { gmail: gmailOutcome } = await searchParams;
  const [t, captures, options, gmail] = await Promise.all([
    getT(),
    listCaptures(access, { limit: 20 }),
    getCaptureProjectOptions(access),
    getGmailStatus(access.userId),
  ]);
  // The OAuth callback lands here with its outcome in the query string.
  const notice =
    gmailOutcome === "connected"
      ? { tone: "ok", text: t("gmail.connectedNotice") }
      : gmailOutcome === "error"
        ? { tone: "error", text: t("gmail.errorNotice") }
        : gmailOutcome === "not_configured"
          ? { tone: "error", text: t("gmail.notConfigured") }
          : null;

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
      <CaptureWorkspace
        initialCaptures={captures.map(toCaptureView)}
        projects={options.projects}
        colleagues={options.colleagues}
        personalProjectId={options.personalProjectId}
        gmail={gmail}
      />
    </div>
  );
}
