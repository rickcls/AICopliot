import { createHash, randomBytes } from "node:crypto";
import type { WorkspaceRole } from "@/generated/prisma/enums";

/**
 * Invite links and member changes, kept pure so the rules that decide who may
 * join and who may be removed are tested without a database.
 *
 * A link is a bearer token: whoever holds it joins. So the token is 32 random
 * bytes, it is shown once to the admin who made it, and only its SHA-256 is
 * stored — a leaked database row cannot be turned back into a working link.
 * Lookups are always by hash, never by the raw token.
 */

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InviteState = "valid" | "expired" | "accepted" | "revoked";

/** Revoked beats accepted beats expired: the most deliberate fact wins. */
export function inviteState(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "accepted";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export type MemberChange = { kind: "remove" } | { kind: "role"; role: WorkspaceRole };

export type MemberChangeCheck =
  | { ok: true }
  | { ok: false; reason: "not_admin" | "owner" | "last_admin" };

/**
 * Whether `actor` may make `change` to `target`.
 *
 * - Only admins change other people. Anyone may remove themselves (leave).
 * - The workspace owner cannot be removed or demoted: deleting the owner's row
 *   is what deletes the workspace, so the owner must always be able to reach it.
 * - The last admin cannot be removed or demoted, or nobody could manage the
 *   workspace again.
 */
export function canChangeMember({
  actor,
  target,
  adminCount,
  change,
}: {
  actor: { userId: string; role: WorkspaceRole };
  target: { userId: string; role: WorkspaceRole; isOwner: boolean };
  adminCount: number;
  change: MemberChange;
}): MemberChangeCheck {
  const isSelf = actor.userId === target.userId;
  const leaving = isSelf && change.kind === "remove";
  if (actor.role !== "admin" && !leaving) return { ok: false, reason: "not_admin" };

  const losesAdmin =
    target.role === "admin" &&
    (change.kind === "remove" || change.role !== "admin");
  if (target.isOwner && (change.kind === "remove" || losesAdmin)) {
    return { ok: false, reason: "owner" };
  }
  if (losesAdmin && adminCount <= 1) return { ok: false, reason: "last_admin" };
  return { ok: true };
}
