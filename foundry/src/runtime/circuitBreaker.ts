import type { Logger } from "../utils/logger.js";

export class CircuitBreaker {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly failureThreshold: number,
    private readonly windowMs: number,
    private readonly logger: Logger,
  ) {}

  private pruneWindow(key: string): number[] {
    const now = Date.now();
    const timestamps = this.failures.get(key) ?? [];
    const pruned = timestamps.filter((t) => now - t <= this.windowMs);
    this.failures.set(key, pruned);
    return pruned;
  }

  isOpen(key: string): boolean {
    const pruned = this.pruneWindow(key);
    return pruned.length >= this.failureThreshold;
  }

  recordFailure(key: string): void {
    const wasOpen = this.isOpen(key);
    const timestamps = this.pruneWindow(key);
    timestamps.push(Date.now());
    this.failures.set(key, timestamps);

    if (!wasOpen && this.isOpen(key)) {
      this.logger.info(
        {
          event: "circuit_breaker_opened",
          key,
          failureCount: timestamps.length,
          windowMs: this.windowMs,
        },
        "Circuit breaker opened",
      );
    }
  }

  recordSuccess(key: string): void {
    const wasOpen = this.isOpen(key);
    if (wasOpen) {
      this.logger.info(
        { event: "circuit_breaker_reset", key },
        "Circuit breaker reset after success",
      );
    }
    this.failures.set(key, []);
  }
}
