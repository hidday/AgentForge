import type { PrismaClient } from "@prisma/client";
import type { RunEventRecord } from "../domain/types.js";

function toDomain(row: {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson: unknown;
  createdAt: Date;
}): RunEventRecord {
  return {
    ...row,
    payloadJson: row.payloadJson,
  };
}

export class EventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    runId: string;
    eventType: string;
    source: string;
    payloadJson?: unknown;
  }): Promise<RunEventRecord> {
    const row = await this.prisma.aiEvent.create({
      data: {
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: (params.payloadJson ?? {}) as object,
      },
    });
    return toDomain(row);
  }

  async findByRunId(runId: string): Promise<RunEventRecord[]> {
    const rows = await this.prisma.aiEvent.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }
}
