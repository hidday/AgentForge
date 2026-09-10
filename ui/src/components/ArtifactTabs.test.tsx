import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactTabs } from "./ArtifactTabs";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "r1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet/i),
    ).toBeDefined();
  });

  it("shows only tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan" }), makeArtifact({ type: "Review", id: "a2" })]}
      />,
    );
    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Code Review")).toBeDefined();
    expect(screen.queryByText("Execution")).toBeNull();
  });

  it("defaults to the first available tab and renders its content", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } })]}
      />,
    );
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("switches tabs on click", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } }),
          makeArtifact({
            id: "a2",
            type: "ExecutionReport",
            payloadJson: { summary: "Execution summary" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Plan summary")).toBeDefined();
    fireEvent.click(screen.getByText("Execution"));
    expect(screen.getByText("Execution summary")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("renders a PlanReview artifact using ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanReview", payloadJson: { overallVerdict: "approved" } }),
        ]}
      />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a PlanRevision artifact with dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "Makes sense" },
                { findingId: "f2", status: "dismissed", rationale: "Not applicable" },
                { findingId: "f3", status: "partially_incorporated", rationale: "Partial" },
                { findingId: "f4", status: "other", rationale: "Other" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
  });

  it("shows a fallback for a PlanRevision artifact with no dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders a Remediation artifact with resolutions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "f1", status: "accepted", action: "Fixed", rationale: "r1" },
                { findingId: "f2", status: "rejected", action: "Won't fix", rationale: "r2" },
                { findingId: "f3", status: "deferred", action: "Later", rationale: "r3" },
              ],
              executionReport: { executionVersion: 3 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed")).toBeDefined();
    expect(screen.getByText(/v3/)).toBeDefined();
  });

  it("defaults the remediation execution version reference to v2 when absent", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Remediation", payloadJson: { resolution: [] } })]}
      />,
    );
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("shows rejection feedback sorted by plan version descending", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "rej1",
            type: "RejectionContext",
            version: 1,
            payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
          }),
          makeArtifact({
            id: "rej2",
            type: "RejectionContext",
            version: 2,
            payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
          }),
        ]}
      />,
    );
    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0]!.textContent).toBe("Plan V2 Rejection");
    expect(headings[1]!.textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("First rejection")).toBeDefined();
  });

});
