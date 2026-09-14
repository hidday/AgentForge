import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

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
    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.create.mockResolvedValue(makeRow());
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
      expect(result.id).toBe("event-1");
    });

    it("passes through an explicit payloadJson", async () => {
      const prisma = makePrismaMock();
      const payload = { planVersion: 2 };
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: payload }));
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: payload,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: payload,
        },
      });
      expect(result.payloadJson).toEqual(payload);
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt ascending", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrismaMock();
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const repo = new EventRepository(prisma as unknown as PrismaClient);

      expect(await repo.findByRunId("run-1")).toEqual([]);
    });
  });
});
