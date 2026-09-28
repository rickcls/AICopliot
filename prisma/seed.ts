/**
 * Creates a demo user and workspace so you can sign in immediately, plus a
 * sample project plan so the task board, timeline, and dashboard have something
 * to show before any document is uploaded.
 *
 * Safe to re-run: the user is upserted, no documents are created, and the demo
 * project is skipped once the workspace already has one.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { migrationDatabaseUrl } from "../src/lib/database-url";
import { defaultTaskStatusRows } from "../src/lib/pm/task-statuses";

const connectionString = migrationDatabaseUrl();
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password-123";

/** Midnight UTC `days` from today — the granularity the overdue rules compare at. */
function dayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, name: "Demo Operator", passwordHash },
  });

  const existing = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
  });

  const workspaceId = existing
    ? existing.workspaceId
    : (
        await prisma.workspace.create({
          data: {
            name: "Demo Operator's Workspace",
            ownerId: user.id,
            members: { create: { userId: user.id, role: "admin" } },
          },
        })
      ).id;

  await seedDemoProject(workspaceId, user.id);

  console.log(`Seeded demo user:\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}`);
}

/** Skipped entirely once the workspace has any project, so re-runs add nothing. */
async function seedDemoProject(workspaceId: string, userId: string) {
  const projectCount = await prisma.project.count({ where: { workspaceId } });
  if (projectCount > 0) {
    console.log("Workspace already has projects — skipping the demo plan.");
    return;
  }

  const project = await prisma.project.create({
    data: {
      workspaceId,
      name: "Core Banking Failover Readiness",
      description:
        "Prove the failover runbook works end to end before the December freeze.",
      // The demo seeds tasks, milestones, and risks, so it shows their tabs.
      deliveryEnabled: true,
    },
  });

  await prisma.projectTaskStatus.createMany({
    data: defaultTaskStatusRows(workspaceId, project.id),
  });
  const statuses = await prisma.projectTaskStatus.findMany({
    where: { projectId: project.id },
  });
  const statusIdByKey = new Map(statuses.map((status) => [status.key, status.id]));
  const statusId = (key: string): string => {
    const id = statusIdByKey.get(key);
    if (!id) throw new Error(`Seed: missing default task status "${key}"`);
    return id;
  };

  // One overdue, one blocked, and one done, so the dashboard and timeline have
  // something to show on a fresh install.
  const [reviewRunbook, stagingDrill, updateRunbook, uatSignOff] =
    await Promise.all([
      prisma.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: "Review the failover runbook against current topology",
          description:
            "The runbook still references the retired secondary in DC2.",
          statusId: statusId("done"),
          priority: "high",
          assigneeId: userId,
          estimatedHours: 4,
          startDate: dayOffset(-21),
          dueDate: dayOffset(-14),
          completedAt: dayOffset(-14),
        },
      }),
      prisma.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: "Run a failover drill in staging",
          description: "Full promote-and-rollback cycle with timings recorded.",
          statusId: statusId("in_progress"),
          priority: "urgent",
          assigneeId: userId,
          estimatedHours: 12,
          startDate: dayOffset(-10),
          dueDate: dayOffset(-2),
        },
      }),
      prisma.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: "Update the runbook with measured recovery times",
          statusId: statusId("blocked"),
          priority: "medium",
          estimatedHours: 3,
          startDate: dayOffset(1),
          dueDate: dayOffset(5),
        },
      }),
      prisma.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: "Schedule UAT sign-off with the service owners",
          statusId: statusId("todo"),
          priority: "low",
          estimatedHours: 1,
          startDate: dayOffset(14),
          dueDate: dayOffset(20),
        },
      }),
    ]);

  await prisma.taskDependency.createMany({
    data: [
      {
        workspaceId,
        taskId: stagingDrill.id,
        dependsOnTaskId: reviewRunbook.id,
      },
      {
        workspaceId,
        taskId: updateRunbook.id,
        dependsOnTaskId: stagingDrill.id,
      },
      { workspaceId, taskId: uatSignOff.id, dependsOnTaskId: updateRunbook.id },
    ],
  });

  await prisma.milestone.createMany({
    data: [
      {
        workspaceId,
        projectId: project.id,
        title: "Drill evidence collected",
        description: "Timings and screenshots attached to the change record.",
        targetDate: dayOffset(6),
        status: "at_risk",
      },
      {
        workspaceId,
        projectId: project.id,
        title: "UAT sign-off",
        targetDate: dayOffset(28),
        status: "not_started",
      },
    ],
  });

  await prisma.projectRisk.createMany({
    data: [
      {
        workspaceId,
        projectId: project.id,
        description:
          "The failover procedure has never been tested at production data volumes.",
        impact: "high",
        likelihood: "medium",
        mitigation: "Run the staging drill with a restored production snapshot.",
        status: "open",
      },
      {
        workspaceId,
        projectId: project.id,
        description:
          "Only one engineer has performed a manual promote in the last year.",
        impact: "medium",
        likelihood: "high",
        mitigation: "Pair a second engineer through the staging drill.",
        status: "monitoring",
      },
    ],
  });

  console.log(`Seeded demo project: ${project.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
