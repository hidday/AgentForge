import { describe, it, expect, vi, afterEach } from "vitest";

// Covers logger.ts's production branch: `process.env.NODE_ENV !== "production"
// ? {...} : undefined`. The existing logger.test.ts only ever imports the
// module under the test runner's default (non-production) NODE_ENV, so the
// `undefined` (production) side of that ternary is never taken. We flip
// NODE_ENV and re-import the module fresh to exercise it, inspecting the
// options actually passed to the (mocked) `pino` factory rather than reading
// a `transport` property back off the logger instance -- pino consumes that
// option internally and does not re-expose it.

describe("logger — production transport", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.resetModules();
  });

  it("omits the pino-pretty transport when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();

    let capturedOptions: Record<string, unknown> | undefined;
    vi.doMock("pino", async () => {
      const actual = await vi.importActual<typeof import("pino")>("pino");
      const factory = (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        return (actual as unknown as { default: (o: unknown) => unknown }).default(opts);
      };
      return { default: factory };
    });

    const { logger } = await import("../../src/utils/logger.js");

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.transport).toBeUndefined();
    expect(typeof logger.info).toBe("function");
  });

  it("includes the pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();

    let capturedOptions: Record<string, unknown> | undefined;
    vi.doMock("pino", async () => {
      const actual = await vi.importActual<typeof import("pino")>("pino");
      const factory = (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        return (actual as unknown as { default: (o: unknown) => unknown }).default(opts);
      };
      return { default: factory };
    });

    await import("../../src/utils/logger.js");

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });
});
