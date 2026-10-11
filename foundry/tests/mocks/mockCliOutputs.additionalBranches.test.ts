import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { CliOutputSchema } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

const parser = new OutputParser();

describe("createMockProcessHandler — stdinData undefined fallback", () => {
  it("treats a missing stdinData as an empty string and falls through to the default executor output for claude", async () => {
    const handler = createMockProcessHandler();
    const options: ProcessSpawnOptions = {
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      // stdinData intentionally omitted
    };

    const result = await handler(options);
    const parsed = parser.parse(result.stdout, CliOutputSchema);

    expect(parsed.stage).toBe("executor");
  });
});
