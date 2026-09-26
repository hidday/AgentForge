import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "api",
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
    it("calls prisma.aiEvent.create with the given payload and maps the row", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "api",
        payloadJson: { from: "Todo", to: "Planning" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "STATE_CHANGED",
          source: "api",
          payloadJson: { from: "Todo", to: "Planning" },
        },
      });
      expect(result).toEqual(row);
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrisma();
      const row = makeRow({ payloadJson: {} });
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      await repo.create({
        runId: "run-1",
        eventType: "SOMETHING",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "SOMETHING",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("propagates errors from prisma.aiEvent.create", async () => {
      const prisma = makePrisma();
      prisma.aiEvent.create.mockRejectedValue(new Error("insert failed"));
      const repo = new EventRepository(prisma as never);

      await expect(
        repo.create({ runId: "run-1", eventType: "X", source: "api" }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps every row", async () => {
      const prisma = makePrisma();
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when there are no matching rows", async () => {
      const prisma = makePrisma();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });

    it("propagates errors from prisma.aiEvent.findMany", async () => {
      const prisma = makePrisma();
      prisma.aiEvent.findMany.mockRejectedValue(new Error("db down"));
      const repo = new EventRepository(prisma as never);

      await expect(repo.findByRunId("run-1")).rejects.toThrow("db down");
    });
  });
});
