import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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

function makePrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient & {
    aiEvent: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event row with the given payload and maps it to the domain shape", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);

      const repo = new EventRepository(prisma);
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
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "system",
        payloadJson: { from: "Todo", to: "Planning" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      const repo = new EventRepository(prisma);
      await repo.create({ runId: "run-1", eventType: "PING", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PING",
          source: "system",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt asc, mapped to domain shape", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);

      const repo = new EventRepository(prisma);
      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([]);

      const repo = new EventRepository(prisma);
      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });
  });
});
