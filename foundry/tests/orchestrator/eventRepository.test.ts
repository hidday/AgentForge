import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  const aiEvent = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  return { aiEvent } as unknown as PrismaClient & { aiEvent: typeof aiEvent };
}

describe("EventRepository.create", () => {
  it("creates an event with the given payload", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const repo = new EventRepository(prisma);

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
    expect(result.id).toBe("event-1");
    expect(result.payloadJson).toEqual({ foo: "bar" });
  });

  it("defaults payloadJson to {} when omitted", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
    const repo = new EventRepository(prisma);

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
});

describe("EventRepository.findByRunId", () => {
  it("orders by createdAt asc and maps every row", async () => {
    const prisma = makePrisma();
    const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
    prisma.aiEvent.findMany.mockResolvedValue(rows);
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns an empty array when the run has no events", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.findMany.mockResolvedValue([]);
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-empty");

    expect(result).toEqual([]);
  });
});
