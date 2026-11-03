import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makePrisma(overrides: Partial<{ create: unknown; findMany: unknown }> = {}) {
  return {
    aiEvent: {
      create: overrides.create ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
    },
  } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
}

describe("EventRepository", () => {
  it("creates an event, defaulting payloadJson to {} when omitted", async () => {
    const createdAt = new Date("2024-01-01T00:00:00Z");
    const create = vi.fn().mockResolvedValue({
      id: "evt-1",
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: {},
      createdAt,
    });
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    const result = await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });

    expect(create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "PLAN_CREATED", source: "system", payloadJson: {} },
    });
    expect(result).toEqual({
      id: "evt-1",
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: {},
      createdAt,
    });
  });

  it("creates an event passing through a provided payloadJson", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "evt-2",
      runId: "run-1",
      eventType: "PLAN_APPROVED",
      source: "api",
      payloadJson: { approvedBy: "user-1" },
      createdAt: new Date(),
    });
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    await repo.create({
      runId: "run-1",
      eventType: "PLAN_APPROVED",
      source: "api",
      payloadJson: { approvedBy: "user-1" },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: { approvedBy: "user-1" },
      },
    });
  });

  it("finds all events for a run ordered ascending by createdAt", async () => {
    const rows = [
      { id: "1", runId: "run-1", eventType: "A", source: "s", payloadJson: null, createdAt: new Date(1) },
      { id: "2", runId: "run-1", eventType: "B", source: "s", payloadJson: null, createdAt: new Date(2) },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
  });

  it("returns an empty array when a run has no events", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-empty");

    expect(result).toEqual([]);
  });
});
