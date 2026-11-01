import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma);
  });

  it("create() defaults payloadJson to an empty object when omitted", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const event = await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });
    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "PLAN_CREATED", source: "system", payloadJson: {} },
    });
    expect(event.id).toBe("event-1");
  });

  it("create() forwards an explicit payloadJson", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { foo: "bar" } }));
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

  it("findByRunId() orders events ascending by createdAt and maps every row", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
    const events = await repo.findByRunId("run-1");
    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.id)).toEqual(["event-1", "event-2"]);
  });

  it("findByRunId() returns an empty array when the run has no events", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([]);
    expect(await repo.findByRunId("run-404")).toEqual([]);
  });
});
