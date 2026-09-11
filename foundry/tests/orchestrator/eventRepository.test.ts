import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  const prisma = {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, prismaMock: prisma };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "orchestrator",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("EventRepository", () => {
  let prisma: PrismaClient;
  let prismaMock: ReturnType<typeof buildPrisma>["prismaMock"];
  let repo: EventRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    prismaMock = built.prismaMock;
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates a row with the given payload and maps it to a RunEventRecord", async () => {
      const row = makeRow();
      prismaMock.aiEvent.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });

      expect(prismaMock.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to {} when omitted", async () => {
      prismaMock.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "orchestrator" });

      expect(prismaMock.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("propagates errors from the underlying create call", async () => {
      prismaMock.aiEvent.create.mockRejectedValue(new Error("write failed"));
      await expect(
        repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "orchestrator" }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps every row", async () => {
      const rows = [
        makeRow({ id: "e1", createdAt: new Date("2024-01-01T00:00:00Z") }),
        makeRow({ id: "e2", createdAt: new Date("2024-01-02T00:00:00Z") }),
      ];
      prismaMock.aiEvent.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prismaMock.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when no events exist for the run", async () => {
      prismaMock.aiEvent.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-empty");
      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying findMany call", async () => {
      prismaMock.aiEvent.findMany.mockRejectedValue(new Error("read failed"));
      await expect(repo.findByRunId("run-1")).rejects.toThrow("read failed");
    });
  });
});
