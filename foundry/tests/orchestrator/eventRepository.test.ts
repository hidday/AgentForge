import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_SUBMITTED",
    source: "system",
    payloadJson: { a: 1 },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates an event with the provided payload", async () => {
      const row = makeRow();
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
        payloadJson: { a: 1 },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: { a: 1 },
        },
      });
      expect(result).toEqual(row);
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events for a run ordered chronologically ascending", async () => {
      const rows = [makeRow(), makeRow({ id: "event-2" })];
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(rows);
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
