import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { MailSender } from "@/lib/outbound/mail";
import {
  generateResetToken,
  hashResetToken,
  passwordResetEmail,
  RESET_COOLDOWN_MS,
  resetExpiry,
} from "@/lib/auth/password-reset";

const APP_NAME = "ScopePilot";

class InvalidReset extends Error {
  constructor() {
    super("invalid");
    this.name = "InvalidReset";
  }
}

/**
 * The caller always tells the person to check their email, whether or not
 * the address has an account. A second ask inside a minute does not send
 * another message.
 */
export async function requestPasswordReset(input: {
  email: string;
  origin: string;
  sender: MailSender;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, locale: true },
  });
  if (!user) return;

  const recent = await prisma.passwordReset.findFirst({
    where: {
      userId: user.id,
      createdAt: { gt: new Date(now.getTime() - RESET_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return;

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  await prisma.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    await tx.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: resetExpiry(now),
      },
    });
  });

  const message = passwordResetEmail({
    to: user.email,
    resetUrl: `${input.origin.replace(/\/$/, "")}/reset-password/${token}`,
    locale: user.locale,
    appName: APP_NAME,
  });

  try {
    await input.sender(message);
  } catch (error) {
    console.error(
      "outbound mail failed",
      error instanceof Error ? error.name : "unknown",
    );
    await prisma.passwordReset.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: now },
    });
  }
}

/**
 * Opening the link does not come through here. The claim is conditional, in
 * the same transaction as the password write.
 */
export async function resetPassword(
  token: string,
  password: string,
  now: Date = new Date(),
): Promise<boolean> {
  const tokenHash = hashResetToken(token);
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new InvalidReset();

      const row = await tx.passwordReset.findFirst({
        where: { tokenHash },
        select: { userId: true },
      });
      if (!row) throw new InvalidReset();

      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash },
      });
      await tx.passwordReset.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
    return true;
  } catch (error) {
    if (error instanceof InvalidReset) return false;
    throw error;
  }
}
