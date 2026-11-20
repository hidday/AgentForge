import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Stub out the heavy sibling view components so these tests focus on
// ArtifactTabs' own tab-selection and artifact-routing logic, while still
// asserting the right payload is forwarded to the right view.
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

function makeArtifact(
  type: string,
  version: number,
  payloadJson: unknown,
  id?: string,
): Artifact {
  return {
    id: id ?? `${type}-${version}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output/i),
    ).toBeDefined();
  });

  it("renders a single tab and its content when only one artifact type is present", () => {
    const plan = { summary: "Do the thing", steps: [] };
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", 1, plan)]} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByTestId("plan-view").textContent).toBe(JSON.stringify(plan));
  });

  it("orders available tabs by the fixed TABS order, not artifact insertion order, and defaults to the first", () => {
    const review = { overallVerdict: "approve", findings: [] };
    const plan = { summary: "plan summary", steps: [] };
    // Review artifact appears first in the array, but Plan should still be the
    // first tab/button and the default active tab, since TABS defines
    // plan before review.
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Review", 1, review), makeArtifact("Plan", 1, plan)]}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Plan", "Code Review"]);
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("switches content and active styling when a different tab is clicked", async () => {
    const review = { overallVerdict: "approve", findings: [] };
    const plan = { summary: "plan summary", steps: [] };
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", 1, plan), makeArtifact("Review", 1, review)]}
      />,
    );

    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(planTab.className).toContain("bg-accent");
    expect(reviewTab.className).not.toContain("bg-accent");

    await userEvent.click(reviewTab);

    expect(screen.getByTestId("review-view").textContent).toBe(JSON.stringify(review));
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(reviewTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
  });

  it("routes a PlanReview artifact through ReviewView under the 'Plan Review' tab", () => {
    const planReview = { overallVerdict: "reject", findings: [] };
    render(<ArtifactTabs artifacts={[makeArtifact("PlanReview", 1, planReview)]} />);

    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByTestId("review-view").textContent).toBe(JSON.stringify(planReview));
  });

  it("routes an ExecutionReport artifact through ExecutionReportView under the 'Execution' tab", () => {
    const report = { summary: "done", filesChanged: ["a.ts"] };
    render(<ArtifactTabs artifacts={[makeArtifact("ExecutionReport", 1, report)]} />);

    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.getByTestId("execution-view").textContent).toBe(JSON.stringify(report));
  });

  it("shows 'No data available' when the active tab's artifact disappears after a prop update", async () => {
    const review = { overallVerdict: "approve", findings: [] };
    const plan = { summary: "plan summary", steps: [] };
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", 1, plan), makeArtifact("Review", 1, review)]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();

    // Simulate the review artifact being removed from the run while the
    // Code Review tab is still selected.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", 1, plan)]} />);

    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("No data available")).toBeDefined();
  });

  describe("Rejection Feedback tab", () => {
    const rejectionV1 = {
      planVersion: 1,
      feedback: "First round of feedback",
      source: "api" as const,
    };
    const rejectionV2 = {
      planVersion: 2,
      feedback: "Second round of feedback",
      source: "linear" as const,
    };

    it("sorts multiple rejection artifacts by descending plan version", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("RejectionContext", 1, rejectionV1, "rej-1"),
            makeArtifact("RejectionContext", 2, rejectionV2, "rej-2"),
          ]}
        />,
      );

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings.map((h) => h.textContent)).toEqual([
        "Plan V2 Rejection",
        "Plan V1 Rejection",
      ]);
      expect(screen.getByText("First round of feedback")).toBeDefined();
      expect(screen.getByText("Second round of feedback")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("shows 'No rejection feedback recorded' when the tab is active but no rejection artifacts remain", async () => {
      const plan = { summary: "plan", steps: [] };
      const { rerender } = render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("Plan", 1, plan),
            makeArtifact("RejectionContext", 1, rejectionV1),
          ]}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
      expect(screen.getByText("First round of feedback")).toBeDefined();

      rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", 1, plan)]} />);

      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  describe("Plan Revision tab (PlanRevisionView)", () => {
    it("shows 'No dispositions recorded' for an empty dispositions list", () => {
      render(
        <ArtifactTabs
          artifacts={[makeArtifact("PlanRevision", 1, { dispositions: [] })]}
        />,
      );
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders dispositions with finding id, humanized status, and rationale", () => {
      const revision = {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Looks good" },
          { findingId: "F2", status: "dismissed", rationale: "Not relevant" },
          {
            findingId: "F3",
            status: "partially_incorporated",
            rationale: "Partially addressed",
          },
          { findingId: "F4", status: "pending", rationale: "Still open" },
        ],
      };
      render(<ArtifactTabs artifacts={[makeArtifact("PlanRevision", 1, revision)]} />);

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("Looks good")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // Underscores in the status are replaced with spaces for display.
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("pending")).toBeDefined();
      expect(screen.getByText("Still open")).toBeDefined();
    });
  });

  describe("Remediation tab (RemediationView)", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      const remediation = {
        resolution: [
          { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "done" },
          { findingId: "F2", status: "rejected", action: "Skipped", rationale: "n/a" },
          { findingId: "F3", status: "deferred", action: "Later", rationale: "backlog" },
        ],
        executionReport: { executionVersion: 3 },
      };
      render(<ArtifactTabs artifacts={[makeArtifact("Remediation", 1, remediation)]} />);

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      expect(screen.getByText(/v3 report/)).toBeDefined();
    });

    it("falls back to execution version 2 when no executionReport is present", () => {
      const remediation = { resolution: [] };
      render(<ArtifactTabs artifacts={[makeArtifact("Remediation", 1, remediation)]} />);

      expect(screen.getByText(/v2 report/)).toBeDefined();
    });
  });
});
