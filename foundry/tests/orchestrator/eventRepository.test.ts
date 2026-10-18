import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
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

type FakePrisma = ReturnType<typeof makePrisma>;

describe("EventRepository", () => {
  let prisma: FakePrisma;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates an event with the provided payload", async () => {
      const row = makeRow({ payloadJson: { foo: "bar" } });
      prisma.aiEvent.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to an empty object when explicitly undefined", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: undefined,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payloadJson: {} }) }),
      );
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiEvent.create.mockRejectedValue(new Error("db down"));

      await expect(
        repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" }),
      ).rejects.toThrow("db down");
    });
  });

  describe("findByRunId", () => {
    it("returns events for a run ordered oldest first", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-without-events");

      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiEvent.findMany.mockRejectedValue(new Error("query failed"));

      await expect(repo.findByRunId("run-1")).rejects.toThrow("query failed");
    });
  });
});
