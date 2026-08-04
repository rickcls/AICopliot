import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { requireWorkspace } from "@/lib/auth-guard";
import { getScopedProject } from "@/lib/pm/project";

export const dynamic = "force-dynamic";

/**
 * Shell shared by every project section.
 *
 * Section navigation lives in the sidebar, so this is only the header — one
 * navigation system rather than a sidebar and a tab strip disagreeing about
 * where you are. The project lookup is workspace-scoped and deduped with the
 * identical call in each section page via React cache.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/projects" className="text-slate-500 hover:text-slate-900">
          Projects
        </Link>
        <span className="mx-1.5 text-slate-300">/</span>
        <span className="text-slate-900">{project.name}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-pretty text-slate-600">
              {project.description}
            </p>
          ) : null}
        </div>
        <Link
          href={`/chat?project=${project.id}`}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          <MessageSquare className="size-4" aria-hidden />
          Ask this project
        </Link>
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}
