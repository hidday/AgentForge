import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "planner-agent",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      ...overrides,
    },
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the given payload and maps to domain", async () => {
      const row = makeRow();
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "planner-agent",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result.id).toBe("event-1");
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new EventRepository(prisma as never);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "planner-agent",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt asc, mapped to domain", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when no events exist", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });
});
