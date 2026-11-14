import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "api",
    payloadJson: {},
    createdAt: new Date("2026-01-01"),
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma as never);
  });

  it("create() defaults payloadJson to an empty object when omitted", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow());

    await repo.create({ runId: "run-1", eventType: "RUN_REQUESTED", source: "api" });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "RUN_REQUESTED", source: "api", payloadJson: {} },
    });
  });

  it("create() preserves an explicit payloadJson", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { foo: "bar" } }));

    const event = await repo.create({
      runId: "run-1",
      eventType: "RUN_REQUESTED",
      source: "api",
      payloadJson: { foo: "bar" },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payloadJson: { foo: "bar" } }),
    });
    expect(event.payloadJson).toEqual({ foo: "bar" });
  });

  it("findByRunId() returns events ordered oldest first", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "evt-2" })]);

    const events = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
  });
});
