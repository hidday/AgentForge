import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  } as Artifact;
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types present, defaulting to the first available tab", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "the plan" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { verdict: "approved" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Plan is first in TABS order, so it should be active by default.
    expect(screen.getByTestId("plan-view").textContent).toContain("the plan");
  });

  it("switches tab content when a different tab is clicked", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "the plan" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { verdict: "approved" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await user.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("approved");
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("routes PlanReview artifacts through ReviewView same as Review", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan" }),
      makeArtifact({ id: "a2", type: "PlanReview", payloadJson: { verdict: "changes_requested" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await user.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("changes_requested");
  });

  it("routes Execution artifacts through ExecutionReportView", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact({ id: "a1", type: "ExecutionReport", payloadJson: { executionVersion: 1 } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("execution-report-view").textContent).toContain("executionVersion");
  });

  it("highlights the active tab with accent styling and inactive tabs with secondary styling", async () => {
    const user = userEvent.setup();
    const artifacts = [makeArtifact({ type: "Plan" }), makeArtifact({ id: "a2", type: "Review" })];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(planTab.className).toContain("bg-accent");
    expect(reviewTab.className).not.toContain("bg-accent");

    await user.click(reviewTab);
    expect(reviewTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
  });

  it("shows 'No data available' when the active tab's own artifact disappears but other tabs remain", () => {
    const artifacts = [makeArtifact({ id: "a1", type: "Review" })];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("review-view")).toBeDefined();

    // Swap the only artifact's type: activeTab state ("review") persists across the
    // prop update, but a Review artifact no longer exists — exercising the
    // "No data available" branch while the tab bar still shows the new Plan tab.
    rerender(<ArtifactTabs artifacts={[makeArtifact({ id: "a1", type: "Plan" })]} />);
    expect(screen.getByText("No data available")).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  describe("rejection feedback", () => {
    it("shows the latest rejection first, with its source badge and feedback text", () => {
      const artifacts = [
        makeArtifact({
          id: "r1",
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "first pass feedback", source: "api" },
        }),
        makeArtifact({
          id: "r2",
          type: "RejectionContext",
          version: 2,
          payloadJson: { planVersion: 2, feedback: "second pass feedback", source: "linear" },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      const items = screen.getAllByText(/Rejection$/);
      expect(items[0].textContent).toContain("Plan V2 Rejection");
      expect(items[1].textContent).toContain("Plan V1 Rejection");
      expect(screen.getByText("second pass feedback")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("shows 'No rejection feedback recorded' if the tab is selected but artifacts are later removed", async () => {
      const user = userEvent.setup();
      const artifacts = [
        makeArtifact({ id: "a1", type: "Plan" }),
        makeArtifact({
          id: "r1",
          type: "RejectionContext",
          payloadJson: { planVersion: 1, feedback: "fb", source: "api" },
        }),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
      await user.click(screen.getByRole("button", { name: "Rejection Feedback" }));
      expect(screen.getByText("fb")).toBeDefined();

      rerender(<ArtifactTabs artifacts={[makeArtifact({ id: "a1", type: "Plan" })]} />);
      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  describe("PlanRevisionView", () => {
    it("shows 'No dispositions recorded' when dispositions is empty", () => {
      const artifacts = [makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } })];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders each disposition with its status badge text (underscores replaced by spaces) and rationale", () => {
      const artifacts = [
        makeArtifact({
          type: "PlanRevision",
          payloadJson: {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Makes sense" },
              { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
              { findingId: "F3", status: "partially_incorporated", rationale: "Some of it" },
              { findingId: "F4", status: "unknown_status", rationale: "fallback style" },
            ],
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("Makes sense")).toBeDefined();
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
    });
  });

  describe("RemediationView", () => {
    it("renders resolutions with accepted/rejected/other status styling and the default execution version footer", () => {
      const artifacts = [
        makeArtifact({
          type: "Remediation",
          payloadJson: {
            resolution: [
              { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "r1" },
              { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "r2" },
              { findingId: "F3", status: "deferred", action: "Later", rationale: "r3" },
            ],
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("Won't fix")).toBeDefined();
      expect(screen.getByText("Later")).toBeDefined();
      // default fallback executionVersion is 2 when remediation.executionReport is absent
      expect(screen.getByText(/v/).textContent).toContain("2");
    });

    it("uses the remediation's executionReport.executionVersion in the footer when present", () => {
      const artifacts = [
        makeArtifact({
          type: "Remediation",
          payloadJson: {
            resolution: [],
            executionReport: { executionVersion: 5 },
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/v/).textContent).toContain("5");
    });
  });
});
