import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "orchestrator",
    payloadJson: { from: "Todo", to: "Planning" },
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
  };
}

describe("EventRepository", () => {
  it("create() defaults payloadJson to an empty object when not provided", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
    const repo = new EventRepository(prisma as never);

    await repo.create({ runId: "run-1", eventType: "STATE_CHANGED", source: "orchestrator" });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "orchestrator",
        payloadJson: {},
      },
    });
  });

  it("create() passes through an explicit payloadJson", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const repo = new EventRepository(prisma as never);

    const event = await repo.create({
      runId: "run-1",
      eventType: "STATE_CHANGED",
      source: "orchestrator",
      payloadJson: { from: "Todo", to: "Planning" },
    });

    expect(event.payloadJson).toEqual({ from: "Todo", to: "Planning" });
  });

  it("findByRunId returns events ordered by createdAt ascending", async () => {
    const prisma = makePrisma();
    const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
    prisma.aiEvent.findMany.mockResolvedValue(rows);
    const repo = new EventRepository(prisma as never);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
