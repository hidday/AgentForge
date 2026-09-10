import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

describe("EventRepository", () => {
  describe("create", () => {
    it("maps params into the create call shape and returns the domain object", async () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const row = {
        id: "evt-1",
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: { foo: "bar" },
        createdAt,
      };
      const create = vi.fn().mockResolvedValue(row);
      const prisma = { aiEvent: { create } } as unknown as PrismaClient;
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: { foo: "bar" },
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "evt-1",
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: { foo: "bar" },
        createdAt,
      });
    });

    it("defaults payloadJson to {} when omitted", async () => {
      const row = {
        id: "evt-2",
        runId: "run-2",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: {},
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      };
      const create = vi.fn().mockResolvedValue(row);
      const prisma = { aiEvent: { create } } as unknown as PrismaClient;
      const repo = new EventRepository(prisma);

      await repo.create({
        runId: "run-2",
        eventType: "RUN_CREATED",
        source: "api",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-2",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("passes where/orderBy correctly and maps every returned row through toDomain", async () => {
      const rows = [
        {
          id: "evt-1",
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: { a: 1 },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "evt-2",
          runId: "run-1",
          eventType: "STATE_CHANGED",
          source: "system",
          payloadJson: null,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = { aiEvent: { findMany } } as unknown as PrismaClient;
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(rows);
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when no rows are found", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { aiEvent: { findMany } } as unknown as PrismaClient;
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });
  });
});
