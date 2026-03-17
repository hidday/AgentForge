import type { PrismaClient } from "../generated/prisma/client.js";

export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Attempts to mark an external event as processed.
   * Returns true if the event was newly recorded (first time seen).
   * Returns false if the event was already processed (duplicate).
   */
  async tryMarkProcessed(source: string, externalEventId: string): Promise<boolean> {
    try {
      await this.prisma.processedEvent.create({
        data: { source, externalEventId },
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002") {
        return false;
      }
      throw err;
    }
  }
}
