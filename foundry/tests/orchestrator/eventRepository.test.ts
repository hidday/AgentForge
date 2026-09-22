import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "planner",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
    it("creates an event with the provided payload and maps the result", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "planner",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual(row);
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrisma();
      const row = makeRow({ payloadJson: {} });
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      await repo.create({ runId: "run-1", eventType: "BLOCKED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "BLOCKED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to an empty object when explicitly undefined", async () => {
      const prisma = makePrisma();
      const row = makeRow({ payloadJson: {} });
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as never);

      await repo.create({
        runId: "run-1",
        eventType: "BLOCKED",
        source: "system",
        payloadJson: undefined,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payloadJson: {} }),
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered oldest first and maps each row", async () => {
      const prisma = makePrisma();
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);
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

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });
  });
});
