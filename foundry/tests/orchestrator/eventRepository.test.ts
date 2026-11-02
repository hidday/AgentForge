import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

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
  };
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma as never);
  });

  it("creates an event, defaulting payloadJson to {} when omitted", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });
    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "PLAN_CREATED", source: "system", payloadJson: {} },
    });
  });

  it("creates an event preserving a provided payloadJson", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { foo: "bar" } }));
    const event = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
    });
    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "PLAN_CREATED", source: "system", payloadJson: { foo: "bar" } },
    });
    expect(event.payloadJson).toEqual({ foo: "bar" });
  });

  it("findByRunId returns events ordered oldest first", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
    const events = await repo.findByRunId("run-1");
    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
  });
});
