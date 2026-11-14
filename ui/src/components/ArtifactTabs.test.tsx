import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact> & { type: string }): Artifact {
  return {
    id: `artifact-${Math.random()}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/hasn't produced any output/)).toBeDefined();
  });

  it("only shows tabs for artifact types that exist, defaulting to the first", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "the plan" } })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("the plan")).toBeDefined();
  });

  it("switches tabs and renders the corresponding artifact view", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "the plan" } }),
          makeArtifact({
            type: "Review",
            payloadJson: { overallVerdict: "approved", summary: "review summary" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("the plan")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByText("review summary")).toBeDefined();
    expect(screen.queryByText("the plan")).toBeNull();
  });

  it("renders the PlanReview tab using ReviewView", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanReview",
            payloadJson: { overallVerdict: "changes_requested", summary: "needs work" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("needs work")).toBeDefined();
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the ExecutionReport tab using ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "ExecutionReport", payloadJson: { summary: "executed", score: 0.8 } }),
        ]}
      />,
    );
    expect(screen.getByText("executed")).toBeDefined();
  });

  it("renders PlanRevision dispositions, with a fallback status style for unknown statuses", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "fixed" },
                { findingId: "f2", status: "dismissed", rationale: "out of scope" },
                { findingId: "f3", status: "partially_incorporated", rationale: "partial" },
                { findingId: "f4", status: "weird_status", rationale: "n/a" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird status")).toBeDefined();
  });

  it("shows an empty-dispositions message for PlanRevision with no dispositions", () => {
    render(<ArtifactTabs artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and the execution-version hint", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "f1", status: "accepted", action: "fixed it", rationale: "was real" },
              ],
              executionReport: { executionVersion: 3 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("fixed it")).toBeDefined();
    expect(screen.getByText(/v.*3.*report/)).toBeDefined();
  });

  it("sorts RejectionContext artifacts by version descending and renders each", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "RejectionContext",
            version: 1,
            payloadJson: { planVersion: 1, feedback: "first rejection", source: "api" },
          }),
          makeArtifact({
            type: "RejectionContext",
            version: 2,
            payloadJson: { planVersion: 2, feedback: "second rejection", source: "linear" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("first rejection")).toBeDefined();
    expect(screen.getByText("second rejection")).toBeDefined();
    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
  });
});
