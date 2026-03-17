import type { PrismaClient } from "@prisma/client";
import type { ArtifactType as PrismaArtifactType } from "@prisma/client";
import type { Artifact, ArtifactType } from "../domain/types.js";

function toDomain(row: {
  id: string;
  runId: string;
  type: PrismaArtifactType;
  version: number;
  payloadJson: unknown;
  rawText: string;
  createdAt: Date;
}): Artifact {
  return {
    ...row,
    type: row.type as ArtifactType,
    payloadJson: row.payloadJson,
  };
}

export class ArtifactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    runId: string;
    type: ArtifactType;
    version: number;
    payloadJson: unknown;
    rawText: string;
  }): Promise<Artifact> {
    const row = await this.prisma.aiArtifact.create({
      data: {
        runId: params.runId,
        type: params.type as PrismaArtifactType,
        version: params.version,
        payloadJson: params.payloadJson as object,
        rawText: params.rawText,
      },
    });
    return toDomain(row);
  }

  async findByRunId(runId: string): Promise<Artifact[]> {
    const rows = await this.prisma.aiArtifact.findMany({
      where: { runId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async findLatestByType(
    runId: string,
    type: ArtifactType,
  ): Promise<Artifact | null> {
    const row = await this.prisma.aiArtifact.findFirst({
      where: { runId, type: type as PrismaArtifactType },
      orderBy: { version: "desc" },
    });
    return row ? toDomain(row) : null;
  }
}
