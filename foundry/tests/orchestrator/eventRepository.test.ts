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
    it("persists the event with the provided payload", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: { note: "hi" } }),
      );

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { note: "hi" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { note: "hi" },
        },
      });
      expect(result.payloadJson).toEqual({ note: "hi" });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

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
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: undefined,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("propagates database errors", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("foreign key violation"),
      );

      await expect(
        repo.create({ runId: "missing-run", eventType: "PLAN_CREATED", source: "system" }),
      ).rejects.toThrow("foreign key violation");
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered chronologically", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-without-events");

      expect(result).toEqual([]);
    });
  });
});
