/**
 * Which projects a person sees in navigation and project lists: every ordinary
 * project, plus their own personal project — not colleagues' personal ones.
 *
 * This is about clutter, not security. A personal project's tasks and
 * documents still resolve by id for any member, and its documents are still
 * evidence for workspace chat, because the workspace is the security boundary
 * (invariant 1). Anything that must be private lives in a per-user table.
 *
 * It carries an `OR`, so combine it with another filter that has one (such as
 * `activeProjectWhere`) inside an `AND`, never by spreading.
 */
export function visibleProjectWhere(workspaceId: string, viewerId: string) {
  return {
    workspaceId,
    OR: [{ personalOwnerId: null }, { personalOwnerId: viewerId }],
  };
}

/** Narrows any task/milestone filter to records in projects the viewer sees. */
export function inVisibleProjects<T extends object>(
  workspaceId: string,
  viewerId: string,
  where: T,
) {
  return { AND: [where, { project: visibleProjectWhere(workspaceId, viewerId) }] };
}
