import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function seed(): Promise<void> {
  console.log("Seeding database...");

  const existingRun = await prisma.aiRun.findFirst({
    where: { linearIssueId: "LIN-1042" },
  });

  if (existingRun) {
    console.log("Seed data already exists, skipping.");
    return;
  }

  const run = await prisma.aiRun.create({
    data: {
      linearIssueId: "LIN-1042",
      repo: "acme/backend-api",
      workingDirectory: "./workspace",
      state: "Todo",
    },
  });

  await prisma.aiEvent.create({
    data: {
      runId: run.id,
      eventType: "SEED",
      source: "seed-script",
      payloadJson: { message: "Initial seed data" },
    },
  });

  console.log(`Created run: ${run.id}`);
  console.log("Seed complete.");
}

seed()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
