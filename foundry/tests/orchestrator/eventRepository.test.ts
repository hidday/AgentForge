import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "orchestrator",
    payloadJson: { foo: "bar" },
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
  } as never;
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the given fields and maps the result", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });

      expect(create).toHaveBeenCalledWith({
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

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new EventRepository(prisma);

      await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "orchestrator" });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("propagates errors from the underlying create call", async () => {
      const create = vi.fn().mockRejectedValue(new Error("insert failed"));
      const prisma = makePrisma({ create });
      const repo = new EventRepository(prisma);

      await expect(
        repo.create({ runId: "run-1", eventType: "X", source: "y" }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual([]);
    });

    it("maps multiple rows preserving chronological order", async () => {
      const rows = [
        makeRow({ id: "e1", eventType: "PLAN_CREATED" }),
        makeRow({ id: "e2", eventType: "PLAN_REVIEW_APPROVED" }),
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
      expect(result.map((e) => e.eventType)).toEqual(["PLAN_CREATED", "PLAN_REVIEW_APPROVED"]);
    });

    it("propagates errors from the underlying findMany call", async () => {
      const findMany = vi.fn().mockRejectedValue(new Error("query failed"));
      const prisma = makePrisma({ findMany });
      const repo = new EventRepository(prisma);

      await expect(repo.findByRunId("run-1")).rejects.toThrow("query failed");
    });
  });
});
