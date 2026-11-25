import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

vi.mock("./PlanView.tsx", () => ({
  PlanView: ({ plan }: { plan: Record<string, unknown> }) => (
    <div data-testid="plan-view">{JSON.stringify(plan)}</div>
  ),
}));
vi.mock("./ReviewView.tsx", () => ({
  ReviewView: ({ review }: { review: Record<string, unknown> }) => (
    <div data-testid="review-view">{JSON.stringify(review)}</div>
  ),
}));
vi.mock("./ExecutionReportView.tsx", () => ({
  ExecutionReportView: ({ report }: { report: Record<string, unknown> }) => (
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
  ),
}));

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: `artifact-${Math.random()}`,
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state and no tabs when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });

  it("shows only the tabs for artifact types that are present, defaulting to the first", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "the plan" } }),
          makeArtifact({ type: "Review", payloadJson: { verdict: "approved" } }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Plan tab is active by default and renders the Plan artifact's payload.
    expect(screen.getByTestId("plan-view").textContent).toContain("the plan");
  });

  it("switches the active tab and its content when a tab button is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "plan payload" } }),
          makeArtifact({ type: "Review", payloadJson: { verdict: "needs work" } }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByTestId("review-view").textContent).toContain("needs work");
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("uses ReviewView for both the Plan Review and Code Review tabs", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanReview", payloadJson: { verdict: "changes_requested" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("review-view").textContent).toContain("changes_requested");
  });

  it("renders the Execution tab via ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "ExecutionReport", payloadJson: { testsPassed: true } })]}
      />,
    );
    expect(screen.getByTestId("execution-view").textContent).toContain("testsPassed");
  });

  describe("Plan Revision tab", () => {
    it("shows an empty state when there are no dispositions", () => {
      render(
        <ArtifactTabs
          artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } })]}
        />,
      );
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders each disposition with its status styling and rationale", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact({
              type: "PlanRevision",
              payloadJson: {
                dispositions: [
                  { findingId: "F-1", status: "accepted", rationale: "Makes sense" },
                  { findingId: "F-2", status: "dismissed", rationale: "Out of scope" },
                  {
                    findingId: "F-3",
                    status: "partially_incorporated",
                    rationale: "Partially addressed",
                  },
                  { findingId: "F-4", status: "unknown_status", rationale: "Other" },
                ],
              },
            }),
          ]}
        />,
      );

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("Makes sense")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // Underscores in the status label are rendered as spaces.
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact({
              type: "Remediation",
              payloadJson: {
                resolution: [
                  { findingId: "R-1", status: "accepted", action: "Fixed it", rationale: "r1" },
                  { findingId: "R-2", status: "rejected", action: "Won't fix", rationale: "r2" },
                  { findingId: "R-3", status: "deferred", action: "Later", rationale: "r3" },
                ],
                executionReport: { executionVersion: 3 },
              },
            }),
          ]}
        />,
      );

      expect(screen.getByText("R-1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      // Execution version pulled from the payload.
      expect(screen.getByText(/v3/)).toBeDefined();
    });

    it("defaults the referenced execution report version to 2 when absent", () => {
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
      expect(screen.getByText(/v2/)).toBeDefined();
    });
  });

  describe("Rejection Feedback tab", () => {
    it("sorts multiple rejection artifacts by version, descending", () => {
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

      // Default tab is the first available one, which is Plan... but there's
      // no Plan artifact here, so Rejection Feedback is the only tab.
      expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings[0].textContent).toContain("Plan V2");
      expect(headings[1].textContent).toContain("Plan V1");
      expect(screen.getByText("second rejection")).toBeDefined();
      expect(screen.getByText("first rejection")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("falls back to 'No rejection feedback recorded' if the matching artifacts disappear after the tab is already active", () => {
      const { rerender } = render(
        <ArtifactTabs
          artifacts={[
            makeArtifact({
              type: "RejectionContext",
              payloadJson: { planVersion: 1, feedback: "will be removed", source: "api" },
            }),
          ]}
        />,
      );

      expect(screen.getByText("will be removed")).toBeDefined();

      // Re-render with the RejectionContext artifact gone; activeTab state
      // stays "rejectionFeedback" from the initial render.
      rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan", payloadJson: {} })]} />);

      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  it("shows 'No data available' if the active tab's artifact disappears after being selected", () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "x" } }),
          makeArtifact({ type: "Review", payloadJson: { verdict: "y" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Remove the Plan artifact while "plan" remains the active tab.
    rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Review", payloadJson: { verdict: "y" } })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });
});
