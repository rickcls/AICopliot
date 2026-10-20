import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import { getThread, listThreads } from "@/lib/assistant/service";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCaptureProjectOptions } from "@/lib/capture/service";
import { getEnv } from "@/lib/env";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** The assistant. `?thread=` reopens one of the person's own conversations. */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const access = await requireWorkspace();
  const { thread: threadId } = await searchParams;
  const [t, threads, thread, options] = await Promise.all([
    getT(),
    listThreads(access),
    threadId ? getThread(access, threadId) : Promise.resolve(null),
    getCaptureProjectOptions(access),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("assistant.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("assistant.lead")}</p>
      </div>
      {/* The workspace keeps the web-search switch across thread changes.
          The conversation itself is keyed inside, so opening another one
          starts from that thread's messages. */}
      <AssistantWorkspace
        threads={threads.map((row) => ({ id: row.id, title: row.title }))}
        threadId={thread?.id ?? null}
        messages={thread?.messages ?? []}
        projects={options.projects}
        webSearchAvailable={Boolean(getEnv().TAVILY_API_KEY)}
      />
    </div>
  );
}
