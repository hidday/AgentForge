import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeMockPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the given payload and maps the row to a domain record", async () => {
      const mockPrisma = makeMockPrisma();
      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      mockPrisma.aiEvent.create.mockResolvedValue({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
        createdAt,
      });

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });

      expect(mockPrisma.aiEvent.create).toHaveBeenCalledWith({
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
        createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const mockPrisma = makeMockPrisma();
      const createdAt = new Date("2024-01-02T00:00:00.000Z");
      mockPrisma.aiEvent.create.mockResolvedValue({
        id: "event-2",
        runId: "run-2",
        eventType: "RUN_CREATED",
        source: "linear",
        payloadJson: {},
        createdAt,
      });

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      await repo.create({
        runId: "run-2",
        eventType: "RUN_CREATED",
        source: "linear",
      });

      expect(mockPrisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-2",
          eventType: "RUN_CREATED",
          source: "linear",
          payloadJson: {},
        },
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      const failure = new Error("db unavailable");
      mockPrisma.aiEvent.create.mockRejectedValue(failure);

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      await expect(
        repo.create({ runId: "run-3", eventType: "X", source: "api" }),
      ).rejects.toThrow("db unavailable");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered ascending by createdAt and maps all rows", async () => {
      const mockPrisma = makeMockPrisma();
      const rows = [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "A",
          source: "s",
          payloadJson: { a: 1 },
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
        {
          id: "event-2",
          runId: "run-1",
          eventType: "B",
          source: "s",
          payloadJson: null,
          createdAt: new Date("2024-01-02T00:00:00.000Z"),
        },
      ];
      mockPrisma.aiEvent.findMany.mockResolvedValue(rows);

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRunId("run-1");

      expect(mockPrisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(rows);
    });

    it("returns an empty array when no events exist for the run", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiEvent.findMany.mockResolvedValue([]);

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiEvent.findMany.mockRejectedValue(new Error("boom"));

      const repo = new EventRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.findByRunId("run-1")).rejects.toThrow("boom");
    });
  });
});
