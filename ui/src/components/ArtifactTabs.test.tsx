import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
  });

  it("renders only tabs for present artifact types, defaulting to the first", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } }),
          makeArtifact({ type: "Review", payloadJson: { summary: "Review summary" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    // Defaults to first available tab (Plan)
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("switches tab content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } }),
          makeArtifact({ type: "Review", payloadJson: { summary: "Review summary" } }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("renders the Execution tab content via ExecutionReportView", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: { summary: "Implemented the feature", executionVersion: 1 },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.getByText("Implemented the feature")).toBeDefined();
  });

  it("renders rejection feedback entries sorted by version descending with source badge", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "r1",
            type: "RejectionContext",
            version: 1,
            payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
          }),
          makeArtifact({
            id: "r2",
            type: "RejectionContext",
            version: 2,
            payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
    const headings = screen.getAllByText(/Rejection$/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("renders PlanRevision dispositions with accepted/dismissed/partial/default status styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Fixed it" },
                { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
                { findingId: "F3", status: "partially_incorporated", rationale: "Partial" },
                { findingId: "F4", status: "unknown_status", rationale: "Other" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when the PlanRevision has an empty dispositions array", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
        ]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions with accepted/rejected/other status styling and execution version note", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                {
                  findingId: "F1",
                  status: "accepted",
                  action: "Fixed the bug",
                  rationale: "Was a real issue",
                },
                {
                  findingId: "F2",
                  status: "rejected",
                  action: "No change",
                  rationale: "False positive",
                },
                {
                  findingId: "F3",
                  status: "deferred",
                  action: "Will fix later",
                  rationale: "Low priority",
                },
              ],
              executionReport: { executionVersion: 3 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed the bug")).toBeDefined();
    expect(screen.getByText("No change")).toBeDefined();
    expect(screen.getByText("Will fix later")).toBeDefined();
    expect(screen.getByText(/the latest Execution tab/i).textContent).toContain("v3");
  });

  it("defaults the execution version reference to 2 when executionReport is absent", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: { resolution: [] },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/the latest Execution tab/i).textContent).toContain("v2");
  });
});
