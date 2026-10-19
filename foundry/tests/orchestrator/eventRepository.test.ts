import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeMockPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates an event row with the given payload and maps it to domain shape", async () => {
      const createdAt = new Date("2024-01-01T00:00:00Z");
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "orchestrator",
        payloadJson: { version: 1 },
        createdAt,
      });

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "orchestrator",
        payloadJson: { version: 1 },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "orchestrator",
          payloadJson: { version: 1 },
        },
      });
      expect(result).toEqual({
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "orchestrator",
        payloadJson: { version: 1 },
        createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "evt-2",
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: {},
        createdAt: new Date(),
      });

      await repo.create({ runId: "run-1", eventType: "RUN_CREATED", source: "api" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events for a run ordered by createdAt asc, mapped to domain shape", async () => {
      const rows = [
        {
          id: "evt-1",
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: {},
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
        {
          id: "evt-2",
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "orchestrator",
          payloadJson: { version: 1 },
          createdAt: new Date("2024-01-02T00:00:00Z"),
        },
      ];
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("evt-1");
      expect(result[1].id).toBe("evt-2");
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });
});
