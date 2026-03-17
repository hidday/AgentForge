import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log:
      env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
