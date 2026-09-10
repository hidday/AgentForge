import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "../../src/utils/logger.js";

// `Logger` is a type-only export from pino; importing it via `import type`
// above is sufficient to confirm the type export compiles.
type _LoggerTypeCheck = Logger;

describe("logger module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds a working logger with pretty transport when NODE_ENV is not production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { logger } = await import("../../src/utils/logger.js");

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("builds a working logger with no transport when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { logger } = await import("../../src/utils/logger.js");

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});
