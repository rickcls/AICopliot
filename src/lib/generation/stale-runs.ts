import "server-only";
import type { GenerationRunType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * A run is `processing` only while the request that created it is alive, and
 * Vercel stops a function at 60 seconds — so a run still processing after this
 * long was killed mid-call and nothing will ever finish it. Left alone it
 * blocks every later run: the active-run check and the one-active-run index
 * both count it, and the page keeps the generate button disabled.
 */
export const STALE_RUN_MS = 3 * 60_000;

export const STALE_RUN_MESSAGE =
  "The request ended before this finished. Please try again.";

/** Marks this project's abandoned runs of one type as failed. */
export async function failStaleRuns(
  workspaceId: string,
  projectId: string,
  type: GenerationRunType,
  now: Date = new Date(),
) {
  await prisma.generationRun.updateMany({
    where: {
      workspaceId,
      projectId,
      type,
      status: "processing",
      createdAt: { lt: new Date(now.getTime() - STALE_RUN_MS) },
    },
    data: { status: "failed", errorMessage: STALE_RUN_MESSAGE },
  });
}
