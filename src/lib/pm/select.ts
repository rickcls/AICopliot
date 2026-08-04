import "server-only";

/**
 * Shared Prisma selections for project-management responses.
 *
 * Kept here rather than in the route files because a `route.ts` may only export
 * HTTP handlers and route config, and because the create/update/list paths must
 * return the same shape — the client panels replace a row in place from the
 * response and would otherwise drop fields.
 */

const citationSelect = {
  id: true,
  excerpt: true,
  chunk: {
    select: {
      id: true,
      pageNumber: true,
      sectionTitle: true,
      document: { select: { id: true, originalFilename: true } },
    },
  },
} as const;

export const taskSelect = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  estimatedHours: true,
  startDate: true,
  dueDate: true,
  source: true,
  generationStatus: true,
  createdAt: true,
  assignee: { select: { id: true, name: true, email: true } },
  dependencies: {
    select: {
      id: true,
      dependsOnTaskId: true,
      dependsOnTask: { select: { title: true, status: true } },
    },
  },
  citations: { select: citationSelect },
} as const;

export const milestoneSelect = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  targetDate: true,
  status: true,
  source: true,
  generationStatus: true,
  createdAt: true,
  citations: { select: citationSelect },
} as const;

export const riskSelect = {
  id: true,
  projectId: true,
  description: true,
  impact: true,
  likelihood: true,
  mitigation: true,
  status: true,
  source: true,
  generationStatus: true,
  createdAt: true,
  citations: { select: citationSelect },
} as const;
