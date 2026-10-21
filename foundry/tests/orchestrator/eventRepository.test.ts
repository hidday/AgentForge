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

function makePrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  describe("create", () => {
    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrisma();
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new EventRepository(prisma);

      const result = await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });

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
      const prisma = makePrisma();
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: { foo: "bar" } }),
      );
      const repo = new EventRepository(prisma);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payloadJson: { foo: "bar" } }),
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered chronologically (ascending)", async () => {
      const prisma = makePrisma();
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "e-1" }),
        makeRow({ id: "e-2" }),
      ]);
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e-1", "e-2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrisma();
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new EventRepository(prisma);

      expect(await repo.findByRunId("run-missing")).toEqual([]);
    });
  });
});
