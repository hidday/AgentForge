import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw plan text",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
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
    it("creates an artifact and maps the result to a domain Artifact", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw plan text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "raw plan text",
        },
      });
      expect(result).toEqual({ ...row, type: "Plan", payloadJson: { foo: "bar" } });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered newest-first, each mapped to the domain shape", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ id: "a1", version: 2 }), makeRow({ id: "a2", version: 1 })];
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(
        rows.map((r) => ({ ...r, type: r.type, payloadJson: r.payloadJson })),
      );
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrismaMock();
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-404");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact with the highest version when found", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ type: "Review", version: 3 });
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual({ ...row, type: "Review", payloadJson: row.payloadJson });
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrismaMock();
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
