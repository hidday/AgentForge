import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_TRANSITION",
    source: "system",
    payloadJson: { from: "Todo", to: "Planning" },
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
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "STATE_TRANSITION",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "STATE_TRANSITION",
          source: "system",
          payloadJson: {},
        },
      });
      expect(result.payloadJson).toEqual({});
    });

    it("passes through an explicit payloadJson and returns the mapped event", async () => {
      const prisma = buildPrismaMock();
      const row = makeRow({
        eventType: "SKILL_DISTILLATION",
        source: "distiller",
        payloadJson: { foo: "bar" },
      });
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distiller",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distiller",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distiller",
        payloadJson: { foo: "bar" },
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps every row", async () => {
      const prisma = buildPrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2" }),
      ]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
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
