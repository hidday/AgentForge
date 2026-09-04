import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();

  const service = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { service, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.startRunsForIssues - non-Error rejection", () => {
  it("stringifies a non-Error rejection from orchestrator.startRun in the error log", async () => {
    const { service, runRepo, orchestrator, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    // Reject with a plain string instead of an Error instance, to exercise
    // the `err instanceof Error ? err.message : String(err)` false branch.
    orchestrator.startRun.mockRejectedValue("planner process crashed");

    const result = await service.startRunsForIssues(["issue-a"]);

    expect(result.skipped).toEqual(["issue-a"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-a", error: "planner process crashed" },
      "Failed to start run for issue",
    );
  });
});
