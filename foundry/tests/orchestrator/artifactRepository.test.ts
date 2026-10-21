import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "test" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact with the given fields and returns the mapped domain object", async () => {
      const prisma = makePrisma();
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "test" },
          rawText: "{}",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by most recent first", async () => {
      const prisma = makePrisma();
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "a-2", version: 2 }),
        makeRow({ id: "a-1", version: 1 }),
      ]);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a-2", "a-1"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrisma();
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma);

      expect(await repo.findByRunId("run-missing")).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the highest-version artifact of the given type", async () => {
      const prisma = makePrisma();
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ type: "Review", version: 3 }),
      );
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrisma();
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma);

      expect(await repo.findLatestByType("run-1", "Remediation")).toBeNull();
    });
  });
});
