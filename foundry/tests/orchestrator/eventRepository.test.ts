import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
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
  it("create() defaults payloadJson to an empty object when omitted", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const repo = new EventRepository(prisma as never);

    const event = await repo.create({ runId: "run-1", eventType: "STATE_CHANGED", source: "orchestrator" });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "orchestrator",
        payloadJson: {},
      },
    });
    expect(event.id).toBe("event-1");
  });

  it("create() forwards a provided payloadJson verbatim", async () => {
    const prisma = makePrisma();
    const payload = { from: "Todo", to: "Planning" };
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: payload }));
    const repo = new EventRepository(prisma as never);

    const event = await repo.create({
      runId: "run-1",
      eventType: "STATE_CHANGED",
      source: "orchestrator",
      payloadJson: payload,
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payloadJson: payload }),
    });
    expect(event.payloadJson).toEqual(payload);
  });

  it("findByRunId() returns events for the run ordered oldest first", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
    const repo = new EventRepository(prisma as never);

    const events = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
  });
});
