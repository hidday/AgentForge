import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(partial: Partial<Artifact> & { id: string; type: string }): Artifact {
  return {
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/hasn't produced any output/i)).toBeDefined();
  });

  it("only shows tabs for artifact types that are present, defaulting to the first one", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "Review summary" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    // First available tab (Plan) is active by default
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("switches tabs on click and renders the matching artifact content", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "Review summary" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("shows 'No data available' when the selected tab's artifact disappears on a later update", async () => {
    const initial = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "Review summary" } }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={initial} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary")).toBeDefined();

    // Simulate the review artifact disappearing from a later poll while the tab button
    // itself remains available because other tabs still exist.
    const updated = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
    ];
    rerender(<ArtifactTabs artifacts={updated} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' when the rejection artifacts disappear on a later update", async () => {
    const initial = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({
        id: "a2",
        type: "RejectionContext",
        payloadJson: { planVersion: 1, feedback: "Needs rework", source: "api" },
      }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={initial} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Needs rework")).toBeDefined();

    // The rejection artifact disappears from a later poll while the tab's
    // own state (activeTab) persists across the prop update.
    const updated = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
    ];
    rerender(<ArtifactTabs artifacts={updated} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("renders the execution report for the Execution tab", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "ExecutionReport",
        payloadJson: { summary: "Execution summary" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Execution summary")).toBeDefined();
  });

  it("renders plan revision dispositions grouped by status", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Makes sense" },
            { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
            { findingId: "F3", status: "partially_incorporated", rationale: "Partially done" },
            { findingId: "F4", status: "unknown_status", rationale: "Whatever" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when a plan revision has an empty dispositions array", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: { dispositions: [] } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when a plan revision payload omits dispositions entirely", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions with accepted/rejected/other status styling", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "R1", status: "accepted", action: "Fixed", rationale: "Done" },
            { findingId: "R2", status: "rejected", action: "Won't fix", rationale: "Not a bug" },
            { findingId: "R3", status: "deferred", action: "Later", rationale: "Low priority" },
          ],
          executionReport: { executionVersion: 4 },
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("deferred")).toBeDefined();
    expect(screen.getByText(/v4/)).toBeDefined();
  });

  it("defaults the remediation note to execution version 2 when no executionReport is present", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: { resolution: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("renders remediation with no resolution entries when the payload omits the field entirely", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Remediation", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("renders rejection feedback artifacts sorted by version descending, with source badge", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
      }),
      makeArtifact({
        id: "a2",
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
  });

  it("renders a single rejection-feedback artifact correctly", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "RejectionContext",
        payloadJson: { planVersion: 1, feedback: "Only one", source: "api" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Only one")).toBeDefined();
  });

  it("routes the PlanReview tab through ReviewView", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanReview",
        payloadJson: { summary: "Plan review summary" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Plan review summary")).toBeDefined();
  });
});
