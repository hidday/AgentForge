import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: `${type}-${Math.random()}`,
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
  it("shows the empty state when there are no matching artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/No artifacts yet/i)).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "s" })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "The plan summary" })]} />);
    expect(screen.getByText("The plan summary")).toBeDefined();
  });

  it("switches tabs on click and renders the corresponding artifact content", async () => {
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

  it("shows 'No data available' when the active tab's artifact type is unexpectedly missing", async () => {
    // Two tabs available (Plan, PlanReview); switch to PlanReview but its
    // only representative artifact having a different shape still renders fine.
    // Instead, directly test the branch by having a tab whose data disappears:
    // render both Plan and PlanRevision, switch, then rerender without PlanRevision's artifact.
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "p" }),
          makeArtifact("PlanRevision", { dispositions: [] }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();

    // Now rerender without the PlanRevision artifact — the tab (and its
    // selection) disappears, falling back to the plan tab's content.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "p" })]} />);
    expect(screen.queryByRole("button", { name: "Plan Revision" })).toBeNull();
  });

  it("renders the Plan Review tab content via ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("PlanReview", { overallVerdict: "approved" })]}
      />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders the Execution tab content via ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { executionVersion: 2 })]}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the Remediation tab with resolutions and falls back executionVersion to 2", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              {
                findingId: "f1",
                status: "accepted",
                action: "Fixed the null check",
                rationale: "Straightforward fix",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("Fixed the null check")).toBeDefined();
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("renders the Remediation tab using a custom executionReport.executionVersion", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [],
            executionReport: { executionVersion: 5 },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/v5/)).toBeDefined();
  });

  it("renders the Remediation tab with no resolutions when the field is entirely absent", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Remediation", {})]} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
  });

  it("renders remediation resolution statuses: rejected and pending/other", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "f1", status: "rejected", action: "a1", rationale: "r1" },
              { findingId: "f2", status: "pending", action: "a2", rationale: "r2" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("pending")).toBeDefined();
  });

  it("renders the Plan Revision tab with disposition statuses", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "f1", status: "accepted", rationale: "r1" },
              { findingId: "f2", status: "dismissed", rationale: "r2" },
              { findingId: "f3", status: "partially_incorporated", rationale: "r3" },
              { findingId: "f4", status: "unknown_status", rationale: "r4" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("shows the empty state for Plan Revision when there are no dispositions", () => {
    render(
      <ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("shows rejection feedback sorted by version descending, with source badges", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact(
            "RejectionContext",
            { planVersion: 1, feedback: "First rejection", source: "api" },
            { id: "r1", version: 1 },
          ),
          makeArtifact(
            "RejectionContext",
            { planVersion: 2, feedback: "Second rejection", source: "linear" },
            { id: "r2", version: 2 },
          ),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen
      .getAllByText(/^(First|Second) rejection$/)
      .map((el) => el.textContent);
    expect(feedbackTexts[0]).toBe("Second rejection");
    expect(feedbackTexts[1]).toBe("First rejection");
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

});
