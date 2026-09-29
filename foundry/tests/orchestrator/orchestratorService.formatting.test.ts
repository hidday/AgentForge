import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  stubExecutor,
  stubReviewer,
} from "./helpers/testKit.js";

function seedApprovedPlan(h: ReturnType<typeof buildStorefulDeps>, planVersion = 1) {
  return h.artifactRepo.create({
    runId: h.store.run.id,
    type: "Plan",
    version: planVersion,
    payloadJson: makePlan({ planVersion }),
  });
}

function latestExecutionComment(h: ReturnType<typeof buildStorefulDeps>): string {
  const call = h.linearClient.postComment.mock.calls.find(
    (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
  );
  if (!call) throw new Error("No execution report comment was posted");
  return call[1] as string;
}

describe("OrchestratorService -- execution report comment formatting", () => {
  it("omits the Files-changed and Notes sections and renders all three check icons when there are no files/notes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);

    stubExecutor(
      h,
      makeExecutionReport({
        filesChanged: [],
        notes: [],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "skip", details: "not applicable" },
          tests: { status: "fail", details: "1 failing" },
        },
      }),
      1,
    );
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    // The execution report comment is posted right after EXECUTION_FINISHED,
    // before runReview -> markReady runs; markReady separately rejects this
    // particular report for its failing "tests" check (a real, expected policy
    // failure unrelated to comment formatting).
    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "ready_requires_green_checks",
    });

    const comment = latestExecutionComment(h);
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
    expect(comment).toContain(":white_check_mark:"); // pass
    expect(comment).toContain(":x:"); // fail
    expect(comment).toContain(":heavy_minus_sign:"); // skip
  });

  it("collapses the file list into a <details> block when more than 8 files changed, and renders notes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    stubExecutor(
      h,
      makeExecutionReport({
        filesChanged: manyFiles,
        notes: ["Left a TODO for follow-up work."],
      }),
      2,
    );
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runExecution("run-1");

    const comment = latestExecutionComment(h);
    expect(comment).toContain("<details>");
    expect(comment).toContain(`Files changed (${manyFiles.length})`);
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Left a TODO for follow-up work.");
  });

  it("renders the plain (non-collapsed) file list when 8 or fewer files changed", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);

    stubExecutor(h, makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] }), 3);
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runExecution("run-1");

    const comment = latestExecutionComment(h);
    expect(comment).not.toContain("<details>");
    expect(comment).toContain("Files changed (2)");
    expect(comment).toContain("`src/a.ts`");
  });
});
