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

function buildPrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = buildPrismaMock();
      prisma.aiEvent.create.mockResolvedValue(makeRow());
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
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
      expect(result.id).toBe("event-1");
    });

    it("passes through an explicit payloadJson", async () => {
      const prisma = buildPrismaMock();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { from: "Todo" } }));
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
        payloadJson: { from: "Todo" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "planner-agent",
          payloadJson: { from: "Todo" },
        },
      });
      expect(result.payloadJson).toEqual({ from: "Todo" });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt ascending", async () => {
      const prisma = buildPrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["event-1", "event-2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = buildPrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
