import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Covers checkAuth()'s "exit code 0 but no PONG in the response" branch,
// which only applies to a plain (non-exitCodeOnly, non-successPattern)
// config like codex's. runtimeHealthCheck.test.ts covers the non-zero-exit
// no-pong case, but not this exit-0-with-unexpected-output case.

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(stdout = "", stderr = "", exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 5, timedOut: false };
}

describe("RuntimeHealthCheck.runPreflight — codex auth exit 0 without PONG", () => {
  it("fails the codex auth check when the probe exits 0 but the response does not contain 'pong'", async () => {
    const processRunner = makeProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    );

    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v2.0.0");
      if (opts.command === "claude") return okResult('{"loggedIn": true}');
      // codex auth probe: exits 0, but the response text is unrelated noise.
      return okResult("Unrelated status output", "", 0);
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow();

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(true);
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
    expect(codexResult?.authCheck.error).toContain("Unrelated status output");
  });
});
