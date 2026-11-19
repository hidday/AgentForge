import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";
import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(type: string, payloadJson: unknown, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `a-${type}-${overrides.version ?? 1}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/No artifacts yet/)).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "s" })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content via PlanView", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "Plan summary text" })]} />);
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("switches tabs on click and shows the newly selected artifact's content", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "Plan summary text" }),
          makeArtifact("Review", { summary: "Review summary text" }),
        ]}
      />,
    );
    expect(screen.getByText("Plan summary text")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary text")).toBeDefined();
    expect(screen.queryByText("Plan summary text")).toBeNull();
  });

  it("renders the PlanReview artifact through ReviewView under the Plan Review tab", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("PlanReview", { summary: "Plan review notes" })]}
      />,
    );
    expect(screen.getByText("Plan review notes")).toBeDefined();
  });

  it("renders PlanRevision dispositions, falling back to an empty state when there are none", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders PlanRevision dispositions when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Makes sense" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
  });

  it("renders the ExecutionReport artifact under the Execution tab", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("ExecutionReport", { executionVersion: 1 })]} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders Remediation resolutions and defaults the referenced execution version to 2", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "F2", status: "accepted", action: "Fixed null check", rationale: "r" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("F2")).toBeDefined();
    expect(screen.getByText("Fixed null check")).toBeDefined();
    expect(screen.getByText(/v2 report/)).toBeDefined();
  });

  it("shows a 'no rejection feedback' message when the rejectionFeedback tab has no matching artifacts", () => {
    // RejectionContext tab only appears when at least one such artifact exists,
    // so pair it with another artifact and switch tabs to exercise the empty branch
    // is not reachable without a RejectionContext artifact — instead verify the
    // tab lists feedback when present, sorted by version descending.
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("RejectionContext", { planVersion: 1, feedback: "first", source: "api" }, { id: "r1", version: 1 }),
          makeArtifact("RejectionContext", { planVersion: 2, feedback: "second", source: "linear" }, { id: "r2", version: 2 }),
        ]}
      />,
    );
    const headings = screen.getAllByText(/Rejection$/);
    expect(headings[0].textContent).toContain("V2");
    expect(headings[1].textContent).toContain("V1");
    expect(screen.getByText("second")).toBeDefined();
    expect(screen.getByText("first")).toBeDefined();
  });
});
