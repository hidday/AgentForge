import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

vi.mock("@/components/PlanView.tsx", () => ({
  PlanView: ({ plan }: { plan: unknown }) => (
    <div data-testid="plan-view">{JSON.stringify(plan)}</div>
  ),
}));
vi.mock("@/components/ReviewView.tsx", () => ({
  ReviewView: ({ review }: { review: unknown }) => (
    <div data-testid="review-view">{JSON.stringify(review)}</div>
  ),
}));
vi.mock("@/components/ExecutionReportView.tsx", () => ({
  ExecutionReportView: ({ report }: { report: unknown }) => (
    <div data-testid="execution-report-view">{JSON.stringify(report)}</div>
  ),
}));

import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("only shows tabs for artifact types that are present", () => {
    render(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults the active tab to the first available tab and renders its content", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "the plan" } })]}
      />,
    );
    expect(screen.getByTestId("plan-view").textContent).toContain("the plan");
  });

  it("switches active tab content when a different tab button is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "p1", type: "Plan", payloadJson: { summary: "the plan" } }),
          makeArtifact({ id: "r1", type: "Review", payloadJson: { verdict: "approved" } }),
        ]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("approved");
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("renders the ExecutionReport artifact through ExecutionReportView on the Execution tab", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: { executionVersion: 1 },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("execution-report-view").textContent).toContain(
      "executionVersion",
    );
  });

  it("renders the rejection feedback view, sorted descending by version, for RejectionContext artifacts", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "rej1",
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "first rejection", source: "api" },
          }),
          makeArtifact({
            id: "rej2",
            type: "RejectionContext",
            payloadJson: { planVersion: 2, feedback: "second rejection", source: "linear" },
          }),
        ]}
      />,
    );
    const feedbackNodes = screen.getAllByText(/rejection$/);
    expect(feedbackNodes[0].textContent).toBe("second rejection");
    expect(feedbackNodes[1].textContent).toBe("first rejection");
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
  });

  it("shows the 'No rejection feedback recorded' empty state once the active rejection tab's artifacts disappear", () => {
    // Make RejectionContext the ONLY available tab so it becomes the default active tab,
    // then remove it on rerender — activeTab state stays "rejectionFeedback" but
    // activeArtifacts filters to an empty array, hitting the empty-state branch.
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "only rejection", source: "api" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("only rejection")).toBeDefined();

    rerender(
      <ArtifactTabs artifacts={[makeArtifact({ type: "Plan", payloadJson: {} })]} />,
    );
    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("shows the 'No data available' fallback when the artifacts prop changes and the previously-active tab's artifact disappears", () => {
    // The active tab is tracked in local state, initialized once from the first render's
    // availableTabs. If the artifacts prop later changes such that the tab that was active no
    // longer has a backing artifact, activeArtifact becomes undefined even though a stale
    // activeTabDef is still resolved, hitting the "No data available" branch.
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "the plan" } })]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();

    rerender(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Review", payloadJson: { verdict: "approved" } }),
        ]}
      />,
    );
    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("renders plan revision dispositions grouped by finding, with status styling text", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Looks good" },
                { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("F2")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("Looks good")).toBeDefined();
  });

  it("renders the plan revision empty state when there are no dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions and the execution-report pointer with a default version fallback", () => {
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
                  action: "Fixed the null check",
                  rationale: "Was unguarded",
                },
                {
                  findingId: "F2",
                  status: "rejected",
                  action: "Left as-is",
                  rationale: "Not a real bug",
                },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Fixed the null check")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    // No executionReport field present -> falls back to the hardcoded default version "2"
    expect(screen.getByText(/report\./)).toBeDefined();
  });

  it("renders the remediation execution-report pointer using the real executionVersion when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [],
              executionReport: { executionVersion: 5 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/v/).textContent).toContain("5");
  });
});
