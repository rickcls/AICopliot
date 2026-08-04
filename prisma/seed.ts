/**
 * Creates a demo user and workspace so you can sign in immediately.
 * Safe to re-run: the user is upserted and no documents are created.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password-123";

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

  if (!existing) {
    await prisma.workspace.create({
      data: {
        name: "Demo Operator's Workspace",
        ownerId: user.id,
        members: { create: { userId: user.id, role: "admin" } },
      },
    });
  }

  console.log(`Seeded demo user:\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
