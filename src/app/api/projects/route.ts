import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { createProjectSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const projects = await prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            documents: true,
            tasks: true,
            milestones: true,
            risks: true,
          },
        },
      },
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects");
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const duplicate = await prisma.project.findFirst({
      where: { workspaceId, name: parsed.data.name },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "A project with that name already exists" },
        { status: 409 },
      );
    }

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: parsed.data.name,
        description: parsed.data.description || null,
      },
      include: {
        _count: {
          select: {
            documents: true,
            tasks: true,
            milestones: true,
            risks: true,
          },
        },
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects");
  }
}
