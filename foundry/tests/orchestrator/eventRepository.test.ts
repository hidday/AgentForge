import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the provided payloadJson and maps the result to the domain shape", async () => {
      const prisma = makePrismaMock();
      const createdAt = new Date("2026-01-01T00:00:00Z");
      const row = {
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner",
        payloadJson: { foo: "bar" },
        createdAt,
      };
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

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
      expect(result).toEqual({
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner",
        payloadJson: { foo: "bar" },
        createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrismaMock();
      const createdAt = new Date("2026-01-02T00:00:00Z");
      const row = {
        id: "evt-2",
        runId: "run-2",
        eventType: "RUN_STARTED",
        source: "system",
        payloadJson: {},
        createdAt,
      };
      prisma.aiEvent.create.mockResolvedValue(row);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      await repo.create({ runId: "run-2", eventType: "RUN_STARTED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-2",
          eventType: "RUN_STARTED",
          source: "system",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt ascending and maps every row", async () => {
      const prisma = makePrismaMock();
      const rows = [
        {
          id: "evt-1",
          runId: "run-1",
          eventType: "A",
          source: "s1",
          payloadJson: { n: 1 },
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "evt-2",
          runId: "run-1",
          eventType: "B",
          source: "s2",
          payloadJson: null,
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      ];
      prisma.aiEvent.findMany.mockResolvedValue(rows);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(rows);
    });

    it("returns an empty array when there are no events for the run", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });
  });
});
