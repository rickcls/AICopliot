import Link from "next/link";
import { Card, LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";
import { describeInvite } from "@/lib/workspace/service";
import { AcceptInviteButton } from "./accept-invite-button";

export const dynamic = "force-dynamic";

const UNUSABLE_TITLE: Record<"expired" | "accepted" | "revoked", MessageKey> = {
  expired: "invite.expiredTitle",
  accepted: "invite.acceptedTitle",
  revoked: "invite.revokedTitle",
};

/**
 * Where an invite link lands.
 *
 * It sits outside the `(app)` group on purpose: that layout provisions a
 * workspace for anyone signed in without one, and a person following an
 * invite must not be given a workspace of their own before they have joined
 * the one they were invited to. Signed-out visitors go through sign-in or
 * sign-up with this page as the callback, and come back here to accept.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [t, invite, user] = await Promise.all([
    getT(),
    describeInvite(token),
    getSessionUser(),
  ]);

  const isMember =
    user && invite
      ? (await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id },
          },
          select: { userId: true },
        })) !== null
      : false;

  const callback = encodeURIComponent(`/invite/${token}`);

  let body: React.ReactNode;
  if (!invite) {
    body = (
      <>
        <h1 className="text-lg font-semibold">{t("invite.invalidTitle")}</h1>
        <p className="mt-1 text-sm text-sand-500">{t("invite.askForNew")}</p>
      </>
    );
  } else if (isMember) {
    body = (
      <>
        <h1 className="text-lg font-semibold">
          {t("invite.title", { workspace: invite.workspaceName })}
        </h1>
        <p className="mt-1 mb-6 text-sm text-sand-500">{t("invite.alreadyMember")}</p>
        <AcceptInviteButton token={token} label={t("invite.openWorkspace")} />
      </>
    );
  } else if (invite.state !== "valid") {
    body = (
      <>
        <h1 className="text-lg font-semibold">{t(UNUSABLE_TITLE[invite.state])}</h1>
        <p className="mt-1 text-sm text-sand-500">{t("invite.askForNew")}</p>
      </>
    );
  } else {
    const role = t(invite.role === "admin" ? "invite.roleAdmin" : "invite.roleMember");
    body = (
      <>
        <h1 className="text-lg font-semibold">
          {t("invite.title", { workspace: invite.workspaceName })}
        </h1>
        <p className="mt-1 text-sm text-sand-500">{t("invite.lead", { role })}</p>
        <div className="mt-6">
          {user ? (
            <>
              <p className="mb-3 text-xs text-sand-500">
                {t("invite.signedInAs", { email: user.email })}
              </p>
              <AcceptInviteButton token={token} label={t("invite.accept")} />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <LinkButton href={`/login?callbackUrl=${callback}`}>
                {t("invite.signIn")}
              </LinkButton>
              <LinkButton
                href={`/login?callbackUrl=${callback}&mode=signup`}
                variant="secondary"
              >
                {t("invite.createAccount")}
              </LinkButton>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-sm font-semibold tracking-tight"
        >
          {t("app.name")}
        </Link>
        <Card className="p-6">{body}</Card>
      </div>
    </main>
  );
}
