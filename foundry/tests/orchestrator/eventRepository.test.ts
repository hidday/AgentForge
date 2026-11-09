import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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
    it("creates an event with the given payload", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result.id).toBe("event-1");
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: {} }),
      );

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to an empty object when explicitly undefined", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: {} }),
      );

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: undefined,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("preserves falsy-but-defined payloadJson values (e.g. 0, empty string)", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: 0 }),
      );

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: 0,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: 0,
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries events for a run ordered oldest first", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when there are no events for the run", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });
});
