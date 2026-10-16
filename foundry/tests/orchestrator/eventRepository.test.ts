import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: Partial<{ create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }>) {
  return {
    aiEvent: {
      create: overrides.create ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  describe("create", () => {
    it("calls aiEvent.create with the expected data payload and maps the row to domain shape", async () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const row = {
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
        createdAt,
      };
      const create = vi.fn().mockResolvedValue(row);
      const repo = new EventRepository(makePrisma({ create }));

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
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
        createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = {
        id: "evt-2",
        runId: "run-2",
        eventType: "RUN_STARTED",
        source: "api",
        payloadJson: {},
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      };
      const create = vi.fn().mockResolvedValue(row);
      const repo = new EventRepository(makePrisma({ create }));

      await repo.create({ runId: "run-2", eventType: "RUN_STARTED", source: "api" });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-2",
          eventType: "RUN_STARTED",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt ascending and maps every row", async () => {
      const rows = [
        {
          id: "evt-1",
          runId: "run-1",
          eventType: "A",
          source: "s1",
          payloadJson: { n: 1 },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "evt-2",
          runId: "run-1",
          eventType: "B",
          source: "s2",
          payloadJson: null,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const repo = new EventRepository(makePrisma({ findMany }));

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "evt-1",
        runId: "run-1",
        eventType: "A",
        source: "s1",
        payloadJson: { n: 1 },
        createdAt: rows[0].createdAt,
      });
      expect(result[1].payloadJson).toBeNull();
    });

    it("returns an empty array when no events exist for the run", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new EventRepository(makePrisma({ findMany }));

      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });
  });
});
