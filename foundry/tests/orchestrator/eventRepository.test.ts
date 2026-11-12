import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_SUBMITTED",
    source: "system",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFakePrisma() {
  const aiEvent = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  return { aiEvent };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("passes through the given payloadJson and maps the created row", async () => {
      const prisma = makeFakePrisma();
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
        payloadJson: { foo: "bar" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makeFakePrisma();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      const repo = new EventRepository(prisma as never);

      await repo.create({ runId: "run-1", eventType: "PLAN_SUBMITTED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("preserves a falsy-but-not-nullish payloadJson instead of defaulting it", async () => {
      const prisma = makeFakePrisma();
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: 0 }));
      const repo = new EventRepository(prisma as never);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
        payloadJson: 0,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: 0,
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered oldest-first and maps every row", async () => {
      const prisma = makeFakePrisma();
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);
      const repo = new EventRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makeFakePrisma();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as never);

      expect(await repo.findByRunId("run-1")).toEqual([]);
    });
  });
});
