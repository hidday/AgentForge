import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { from: "Todo", to: "Planning" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
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
      const prisma = makePrisma();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      const repo = new EventRepository(prisma as never);

      await repo.create({ runId: "run-1", eventType: "STATE_CHANGED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "STATE_CHANGED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("forwards a provided payloadJson and maps the created row", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "system",
        payloadJson: { from: "Todo", to: "Planning" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "STATE_CHANGED",
          source: "system",
          payloadJson: { from: "Todo", to: "Planning" },
        },
      });
      expect(result).toEqual(row);
    });
  });

  describe("findByRunId", () => {
    it("queries events for a run ordered oldest-first and maps each row", async () => {
      const prisma = makePrisma();
      prisma.aiEvent.findMany.mockResolvedValue([makeRow({ id: "e1" }), makeRow({ id: "e2" })]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrisma();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as never);

      expect(await repo.findByRunId("run-empty")).toEqual([]);
    });
  });
});
