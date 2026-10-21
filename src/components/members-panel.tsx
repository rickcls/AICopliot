"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocale, useT, useTimeZone } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  QUIET_CONTROL,
  SectionHeader,
  Select,
} from "@/components/ui";
import { intlLocale } from "@/lib/i18n/locales";
import { cn, formatInstantDay } from "@/lib/utils";

type Role = "admin" | "member";

export interface MemberRow {
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  isOwner: boolean;
}

export interface InviteRow {
  id: string;
  role: Role;
  expiresAt: string;
}

const ROLE_KEY = { admin: "members.roleAdmin", member: "members.roleMember" } as const;

/**
 * Who is in the workspace, and the links that bring more people in.
 *
 * One line per member, house-pattern: the role is a quiet select only where
 * the viewer may change it, and the owner is the one exception badged. Who may
 * change what is decided on the server (`canChangeMember`); the controls here
 * only avoid offering what would be refused.
 */
export function MembersPanel({
  workspaceName,
  viewerId,
  viewerRole,
  initialMembers,
  initialInvites,
}: {
  workspaceName: string;
  viewerId: string;
  viewerRole: Role;
  initialMembers: MemberRow[];
  initialInvites: InviteRow[];
}) {
  const t = useT();
  const locale = useLocale();
  const timeZone = useTimeZone();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const roleSelectId = useId();
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const isAdmin = viewerRole === "admin";
  const adminCount = members.filter((member) => member.role === "admin").length;
  const displayName = (member: MemberRow) => member.name ?? member.email;

  async function changeRole(member: MemberRow, role: Role) {
    setBusy(member.userId);
    const previous = members;
    setMembers(members.map((row) => (row.userId === member.userId ? { ...row, role } : row)));
    try {
      const response = await fetch(`/api/workspace/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        setMembers(previous);
        const data = await response.json().catch(() => ({}));
        toast.error(t("members.changeFailed"), data.error);
      }
    } catch {
      setMembers(previous);
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: MemberRow) {
    const self = member.userId === viewerId;
    const ok = await confirm({
      title: self
        ? t("members.leaveTitle", { workspace: workspaceName })
        : t("members.removeTitle", { name: displayName(member) }),
      body: self ? t("members.leaveBody") : t("members.removeBody"),
      confirmLabel: self ? t("members.leave") : t("members.remove"),
      tone: "danger",
    });
    if (!ok) return;

    setBusy(member.userId);
    try {
      const response = await fetch(`/api/workspace/members/${member.userId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(t("members.changeFailed"), data.error);
        return;
      }
      if (self) {
        router.push("/today");
        router.refresh();
        return;
      }
      setMembers(members.filter((row) => row.userId !== member.userId));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function createInvite() {
    setBusy("invite");
    setCopied(false);
    try {
      const response = await fetch("/api/workspace/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole }),
      });
      if (!response.ok) {
        toast.error(t("members.createFailed"));
        return;
      }
      const data = (await response.json()) as {
        url: string;
        invite: { id: string; role: Role; expiresAt: string };
      };
      setNewLink(data.url);
      setInvites([data.invite, ...invites]);
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invite: InviteRow) {
    setBusy(invite.id);
    try {
      const response = await fetch(`/api/workspace/invites/${invite.id}`, {
        method: "DELETE",
      });
      // 404 means it was already used or withdrawn: either way it is not pending.
      if (!response.ok && response.status !== 404) {
        toast.error(t("members.revokeFailed"));
        return;
      }
      setInvites(invites.filter((row) => row.id !== invite.id));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
    } catch {
      // Clipboard can be refused (insecure context); the field stays selectable.
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionHeader
          title={t("members.title")}
          description={t("members.lead", { workspace: workspaceName })}
        />
        <Card className="overflow-hidden">
          <ul className="divide-y divide-sand-100">
            {members.map((member) => {
              const self = member.userId === viewerId;
              const canEditRole = isAdmin && !member.isOwner;
              // Mirrors canChangeMember so a refused action is not offered.
              const lastAdmin = member.role === "admin" && adminCount <= 1;
              const canRemove =
                !member.isOwner && !lastAdmin && (isAdmin || self);

              return (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
                >
                  <Avatar name={member.name} email={member.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-sand-900">
                      {displayName(member)}{" "}
                      {self ? (
                        <span className="font-normal text-sand-500">{t("members.you")}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-sand-500">{member.email}</p>
                  </div>
                  {member.isOwner ? <Badge tone="neutral">{t("members.owner")}</Badge> : null}
                  {canEditRole ? (
                    <Select
                      aria-label={t("members.roleLabel", { name: displayName(member) })}
                      value={member.role}
                      disabled={busy === member.userId || (lastAdmin && member.role === "admin")}
                      onChange={(event) => void changeRole(member, event.target.value as Role)}
                      className={cn(QUIET_CONTROL, "h-8 text-xs")}
                    >
                      <option value="admin">{t("members.roleAdmin")}</option>
                      <option value="member">{t("members.roleMember")}</option>
                    </Select>
                  ) : (
                    <span className="text-xs text-sand-500">{t(ROLE_KEY[member.role])}</span>
                  )}
                  {canRemove ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy === member.userId}
                      onClick={() => void remove(member)}
                    >
                      {self ? t("members.leave") : t("members.remove")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title={t("members.invitesTitle")}
          description={isAdmin ? t("members.invitesLead") : t("members.adminOnly")}
        />
        {isAdmin ? (
          <Card className="divide-y divide-sand-100">
            <div className="flex flex-wrap items-end gap-3 p-4">
              <div>
                <label htmlFor={roleSelectId} className="mb-1 block text-xs font-medium text-sand-500">
                  {t("members.inviteAs")}
                </label>
                <Select
                  id={roleSelectId}
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as Role)}
                  className="h-9"
                >
                  <option value="member">{t("members.roleMember")}</option>
                  <option value="admin">{t("members.roleAdmin")}</option>
                </Select>
              </div>
              <Button
                type="button"
                disabled={busy === "invite"}
                onClick={() => void createInvite()}
              >
                <Link2 className="size-4" aria-hidden />
                {t("members.createInvite")}
              </Button>
            </div>

            {newLink ? (
              <div className="space-y-1.5 p-4">
                <p className="text-xs font-medium text-sand-500">{t("members.newLinkLabel")}</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={newLink}
                    aria-label={t("members.newLinkLabel")}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-9 min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button type="button" variant="secondary" onClick={() => void copyLink()}>
                    {copied ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                    {copied ? t("members.copied") : t("members.copy")}
                  </Button>
                </div>
                <p className="text-xs text-amber-700">{t("members.newLinkHint")}</p>
              </div>
            ) : null}

            <div className="p-4">
              <p className="mb-2 text-xs font-medium text-sand-500">{t("members.pending")}</p>
              {invites.length === 0 ? (
                <p className="text-sm text-sand-500">{t("members.noPending")}</p>
              ) : (
                <ul className="space-y-2">
                  {invites.map((invite) => (
                    <li key={invite.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {t(ROLE_KEY[invite.role])}
                        <span className="mx-1.5 text-sand-300">·</span>
                        <span className="text-sand-500">
                          {t("members.expires", {
                            date: formatInstantDay(invite.expiresAt, intlLocale(locale), timeZone),
                          })}
                        </span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy === invite.id}
                        onClick={() => void revoke(invite)}
                      >
                        {t("members.revoke")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
