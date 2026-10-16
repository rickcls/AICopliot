import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/lib/i18n/locales";
import { defaultTaskStatusRows } from "@/lib/pm/task-statuses";

/**
 * Each person's personal project: the home for their own work that belongs to
 * no client or initiative, and (from P1) where a captured task lands when no
 * project is named. One per person per workspace, enforced by
 * `@@unique([workspaceId, personalOwnerId])`.
 *
 * It is an ordinary project in every other respect — renamable, with the same
 * columns and tabs — and only hidden from colleagues' navigation.
 */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function personalProjectName(
  displayName: string | null,
  email: string,
  locale: Locale,
): string {
  const who = displayName?.trim() || email.split("@")[0] || email;
  return locale === "zh-Hant" ? `${who}的個人工作` : `${who}'s work`;
}

async function findPersonalProject(workspaceId: string, userId: string) {
  return prisma.project.findFirst({
    where: { workspaceId, personalOwnerId: userId },
    select: { id: true, name: true },
  });
}

async function createPersonalProject(
  workspaceId: string,
  userId: string,
  name: string,
) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { workspaceId, name, personalOwnerId: userId },
      select: { id: true, name: true },
    });
    await tx.projectTaskStatus.createMany({
      data: defaultTaskStatusRows(workspaceId, created.id),
    });
    return created;
  });
}

/**
 * Returns the person's personal project, creating it on first use.
 *
 * Two requests can race to create it (two tabs opening at once). The loser's
 * insert fails on the unique index, and it re-reads rather than failing. A
 * failure that is *not* the race is a name collision — someone already has a
 * project with this name — so the name is made unique with the email once.
 */
export async function getOrCreatePersonalProject(
  workspaceId: string,
  user: { id: string; name: string | null; email: string },
  locale: Locale,
): Promise<{ id: string; name: string }> {
  const existing = await findPersonalProject(workspaceId, user.id);
  if (existing) return existing;

  const name = personalProjectName(user.name, user.email, locale);
  try {
    return await createPersonalProject(workspaceId, user.id, name);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const raced = await findPersonalProject(workspaceId, user.id);
  if (raced) return raced;

  try {
    return await createPersonalProject(workspaceId, user.id, `${name} (${user.email})`);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const final = await findPersonalProject(workspaceId, user.id);
    if (final) return final;
    throw error;
  }
}
