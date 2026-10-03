import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the given payload", async () => {
      const prisma = buildPrisma();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { from: "Todo", to: "Planning" } }));
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
        payloadJson: { from: "Todo", to: "Planning" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_REQUESTED",
          source: "orchestrator",
          payloadJson: { from: "Todo", to: "Planning" },
        },
      });
      expect(result.id).toBe("event-1");
      expect(result.payloadJson).toEqual({ from: "Todo", to: "Planning" });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = buildPrisma();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      const repo = new EventRepository(prisma as never);

      await repo.create({
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_REQUESTED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt asc, mapped to domain objects", async () => {
      const prisma = buildPrisma();
      prisma.aiEvent.findMany.mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2", eventType: "PLAN_CREATED" }),
      ]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[1].eventType).toBe("PLAN_CREATED");
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = buildPrisma();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-404");

      expect(result).toEqual([]);
    });
  });
});
