import "server-only";

/**
 * Shared Prisma selections for project-management responses.
 *
 * Kept here rather than in the route files because a `route.ts` may only export
 * HTTP handlers and route config, and because the create/update/list paths must
 * return the same shape — the client panels replace a row in place from the
 * response and would otherwise drop fields.
 */

import { officialRecordWhere } from "@/lib/pm/rules";

const citationBaseSelect = {
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

const taskOrRiskCitationSelect = {
  ...citationBaseSelect,
  purpose: true,
} as const;

/**
 * Only official targets are selected, so a coverage chip on a requirement row
 * agrees with the uncovered count on the overview — both exclude proposals a
 * human has not approved.
 *
 * Declared separately rather than inline because `as const` on the enclosing
 * select would make this `OR` array readonly, which Prisma's WhereInput rejects.
 */
const officialLinksSelect = {
  where: {
    OR: [
      { task: officialRecordWhere({}) },
      { milestone: officialRecordWhere({}) },
      { risk: officialRecordWhere({}) },
    ],
  },
  select: {
    id: true,
    targetType: true,
    task: { select: { id: true, title: true, status: true } },
    milestone: { select: { id: true, title: true, status: true } },
    risk: { select: { id: true, description: true, status: true } },
  },
};

export const taskSelect = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  milestoneId: true,
  estimatedHours: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  source: true,
  generationStatus: true,
  generationRunId: true,
  reviewedAt: true,
  reviewedById: true,
  createdAt: true,
  assignee: { select: { id: true, name: true, email: true } },
  milestone: { select: { id: true, title: true } },
  dependencies: {
    where: officialRecordWhere({}),
    select: {
      id: true,
      dependsOnTaskId: true,
      source: true,
      generationStatus: true,
      dependsOnTask: { select: { title: true, status: true } },
      citations: { select: citationBaseSelect },
    },
  },
  citations: { select: taskOrRiskCitationSelect },
} as const;

export const milestoneSelect = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  targetDate: true,
  status: true,
  completedAt: true,
  source: true,
  generationStatus: true,
  generationRunId: true,
  reviewedAt: true,
  reviewedById: true,
  createdAt: true,
  citations: { select: citationBaseSelect },
} as const;

export const riskSelect = {
  id: true,
  projectId: true,
  milestoneId: true,
  description: true,
  impact: true,
  likelihood: true,
  mitigation: true,
  status: true,
  source: true,
  generationStatus: true,
  generationRunId: true,
  reviewedAt: true,
  reviewedById: true,
  createdAt: true,
  milestone: { select: { id: true, title: true } },
  citations: { select: taskOrRiskCitationSelect },
} as const;

export const requirementSelect = {
  id: true,
  projectId: true,
  sequence: true,
  title: true,
  description: true,
  type: true,
  priority: true,
  status: true,
  acceptanceCriteria: true,
  assumptions: true,
  confidence: true,
  stakeholder: true,
  source: true,
  generationStatus: true,
  generationRunId: true,
  reviewedAt: true,
  reviewedById: true,
  createdAt: true,
  citations: { select: citationBaseSelect },
  links: officialLinksSelect,
} as const;
