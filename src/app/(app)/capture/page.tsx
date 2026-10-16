import { CaptureWorkspace } from "@/components/capture/capture-workspace";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCaptureProjectOptions, listCaptures } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Every note the person has captured, newest first, with its suggestions. */
export default async function CapturePage() {
  const access = await requireWorkspace();
  const [t, captures, options] = await Promise.all([
    getT(),
    listCaptures(access, { limit: 20 }),
    getCaptureProjectOptions(access),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("capture.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("capture.lead")}</p>
      </div>
      <CaptureWorkspace
        initialCaptures={captures.map(toCaptureView)}
        projects={options.projects}
        personalProjectId={options.personalProjectId}
      />
    </div>
  );
}
