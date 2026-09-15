import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { from: "Todo", to: "Planning" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  describe("create", () => {
    it("passes the given payloadJson through and maps the returned row", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "system",
        payloadJson: { from: "Todo", to: "Planning" },
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "STATE_CHANGED",
          source: "system",
          payloadJson: { from: "Todo", to: "Planning" },
        },
      });
      expect(result.id).toBe("event-1");
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new EventRepository(prisma);

      await repo.create({ runId: "run-1", eventType: "RUN_CREATED", source: "api" });

      expect(create).toHaveBeenCalledWith({
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
    it("orders by createdAt asc and maps every row", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new EventRepository(prisma);

      expect(await repo.findByRunId("run-none")).toEqual([]);
    });
  });
});
