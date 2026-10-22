import { ConnectedAccounts } from "@/components/connected-accounts";
import { MembersPanel } from "@/components/members-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { requireWorkspace, getUserPreferences } from "@/lib/auth-guard";
import { getLocale, getT } from "@/lib/i18n/server";
import { getGmailStatus } from "@/lib/gmail/service";
import { getOutlookStatus } from "@/lib/outlook/service";
import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { listMembers, listPendingInvites } from "@/lib/workspace/service";

export const dynamic = "force-dynamic";

/**
 * The zone list is built on the server and passed down, so the options cannot
 * differ between the server render and a browser with a different ICU build.
 * The saved zone is always offered, even if this runtime does not list it.
 */
function timeZoneOptions(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  zones.add(current);
  return [...zones].sort();
}

export default async function SettingsPage() {
  const access = await requireWorkspace();
  const { userId, workspaceId, workspaceName, role } = access;
  const [t, locale, preferences, members, invites, gmail, outlook] = await Promise.all([
    getT(),
    getLocale(),
    getUserPreferences(userId),
    listMembers(workspaceId),
    role === "admin" ? listPendingInvites(access) : Promise.resolve([]),
    getGmailStatus(userId),
    getOutlookStatus(userId),
  ]);
  const timeZone = preferences?.timeZone ?? DEFAULT_TIME_ZONE;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-sand-600">{t("settings.lead")}</p>
      </div>
      <SettingsPanel
        locale={locale}
        timeZone={timeZone}
        timeZones={timeZoneOptions(timeZone)}
      />
      <div className="mt-10">
        <ConnectedAccounts gmail={gmail} outlook={outlook} />
      </div>
      <div className="mt-10">
        {/* Keyed on the workspace so switching workspaces remounts the panel
            with that workspace's members rather than keeping stale state. */}
        <MembersPanel
          key={workspaceId}
          workspaceName={workspaceName}
          viewerId={userId}
          viewerRole={role}
          initialMembers={members.map((member) => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
            role: member.role,
            isOwner: member.isOwner,
          }))}
          initialInvites={invites.map((invite) => ({
            id: invite.id,
            role: invite.role,
            expiresAt: invite.expiresAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
