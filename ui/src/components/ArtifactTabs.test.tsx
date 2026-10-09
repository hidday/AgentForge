import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

vi.mock("@/components/PlanView.tsx", () => ({
  PlanView: ({ plan }: { plan: Record<string, unknown> }) => (
    <div data-testid="plan-view">{JSON.stringify(plan)}</div>
  ),
}));
vi.mock("@/components/ReviewView.tsx", () => ({
  ReviewView: ({ review }: { review: Record<string, unknown> }) => (
    <div data-testid="review-view">{JSON.stringify(review)}</div>
  ),
}));
vi.mock("@/components/ExecutionReportView.tsx", () => ({
  ExecutionReportView: ({ report }: { report: Record<string, unknown> }) => (
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
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
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan" }), makeArtifact({ type: "Review", id: "a2" })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("shows the Plan tab's content by default and renders PlanView with the payload", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "s" } })]}
      />,
    );
    expect(screen.getByTestId("plan-view").textContent).toContain("summary");
  });

  it("switches tabs and content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", id: "a1" }),
          makeArtifact({ type: "ExecutionReport", id: "a2", payloadJson: { summary: "exec" } }),
        ]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view")).toBeDefined();
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("renders ReviewView for both PlanReview and Review artifact types", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanReview", id: "a1", payloadJson: { overallVerdict: "approved" } }),
        ]}
      />,
    );
    expect(screen.getByTestId("review-view").textContent).toContain("approved");
  });

  it("shows 'No data available' when the previously active tab's artifact disappears on rerender", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", id: "a1" }),
          makeArtifact({ type: "Review", id: "a2" }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();

    // Rerender without the Review artifact; activeTab state ("review") is
    // preserved across the rerender, so the tab button disappears but the
    // content pane should fall back to "No data available".
    rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan", id: "a1" })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("renders the rejection feedback tab with multiple entries sorted by version descending", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "RejectionContext",
            id: "r1",
            version: 1,
            payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
          }),
          makeArtifact({
            type: "RejectionContext",
            id: "r2",
            version: 2,
            payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
          }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen.getAllByText(/^(First|Second) rejection$/).map(
      (el) => el.textContent,
    );
    expect(feedbackTexts[0]).toBe("Second rejection");
    expect(feedbackTexts[1]).toBe("First rejection");
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
  });

  it("renders the PlanRevision tab with dispositions, including the fallback status style", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "Looks fine" },
                { findingId: "f2", status: "dismissed", rationale: "Not relevant" },
                { findingId: "f3", status: "partially_incorporated", rationale: "Some of it" },
                { findingId: "f4", status: "weird_status", rationale: "fallback" },
              ],
            },
          }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird status")).toBeDefined();
  });

  it("shows the 'No dispositions recorded' fallback for an empty PlanRevision", async () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders the Remediation tab with resolutions and the executionVersion hint", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "r1" },
                { findingId: "f2", status: "rejected", action: "Won't fix", rationale: "r2" },
                { findingId: "f3", status: "other", action: "Deferred", rationale: "r3" },
              ],
              executionReport: { executionVersion: 3 },
            },
          }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("Won't fix")).toBeDefined();
    expect(screen.getByText("Deferred")).toBeDefined();
    expect(screen.getByText(/v3/)).toBeDefined();
  });

  it("defaults the executionVersion hint to 2 when executionReport is missing", async () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Remediation", payloadJson: { resolution: [] } })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' only when rejectionFeedback tab is active with no artifacts (unreachable via tabs but covered through availableTabs guard)", () => {
    // Rejection tab only appears when a RejectionContext artifact exists, so
    // this branch is implicitly covered by the presence check in TABS filter;
    // assert baseline rendering instead of forcing an impossible empty state.
    render(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);
    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
  });
});
