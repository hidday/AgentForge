import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
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
    <div data-testid="execution-report-view">{JSON.stringify(report)}</div>
  ),
}));

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: overrides.id ?? `${type}-${Math.random()}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only tabs for artifact types that are present, defaulting to the first available tab", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "the plan" }),
      makeArtifact("Review", { verdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    // Tabs with no matching artifact are not rendered
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();

    // Default active tab is "Plan" (first in TABS order that is available)
    expect(screen.getByTestId("plan-view").textContent).toBe(
      JSON.stringify({ summary: "the plan" }),
    );
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("switches the active tab and its content when a different tab is clicked", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("Plan", { summary: "the plan" }),
      makeArtifact("Review", { verdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ verdict: "approved" }),
    );

    // The clicked tab now carries the active styling
    expect(screen.getByRole("button", { name: "Code Review" }).className).toContain(
      "bg-accent",
    );
    expect(screen.getByRole("button", { name: "Plan" }).className).not.toContain("bg-accent");
  });

  it("passes the PlanReview artifact through ReviewView on the Plan Review tab", () => {
    const artifacts = [makeArtifact("PlanReview", { verdict: "changes_requested" })];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ verdict: "changes_requested" }),
    );
  });

  it("renders the Execution tab through ExecutionReportView", () => {
    const artifacts = [makeArtifact("ExecutionReport", { executionVersion: 3 })];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("execution-report-view").textContent).toBe(
      JSON.stringify({ executionVersion: 3 }),
    );
  });

  describe("PlanRevisionView", () => {
    it("renders dispositions with status styling and rationale", () => {
      const artifacts = [
        makeArtifact("PlanRevision", {
          dispositions: [
            { findingId: "F-1", status: "accepted", rationale: "Looks good" },
            { findingId: "F-2", status: "dismissed", rationale: "Out of scope" },
            {
              findingId: "F-3",
              status: "partially_incorporated",
              rationale: "Partial fix applied",
            },
            { findingId: "F-4", status: "unknown_status", rationale: "n/a" },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("Looks good")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // underscore replaced with space in the label
      expect(screen.getByText("partially incorporated")).toBeDefined();
      // Also gets the underscore-to-space treatment even though it falls
      // through to the default (unstyled) status badge case.
      expect(screen.getByText("unknown status")).toBeDefined();
    });

    it("shows 'No dispositions recorded' when dispositions is empty", () => {
      const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("shows 'No dispositions recorded' when dispositions is missing entirely", () => {
      const artifacts = [makeArtifact("PlanRevision", {})];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });
  });

  describe("RemediationView", () => {
    it("renders resolutions with accepted/rejected/other status styling and the execution version footnote", () => {
      const artifacts = [
        makeArtifact("Remediation", {
          resolution: [
            { findingId: "R-1", status: "accepted", action: "Fixed the bug", rationale: "done" },
            { findingId: "R-2", status: "rejected", action: "Declined", rationale: "not valid" },
            { findingId: "R-3", status: "deferred", action: "Later", rationale: "low priority" },
          ],
          executionReport: { executionVersion: 5 },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("R-1")).toBeDefined();
      expect(screen.getByText("Fixed the bug")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      const footnote = screen.getByText(/report\./).closest("p");
      expect(footnote?.textContent).toContain("v5 report.");
    });

    it("defaults the execution version footnote to 2 when executionReport is missing", () => {
      const artifacts = [makeArtifact("Remediation", { resolution: [] })];
      render(<ArtifactTabs artifacts={artifacts} />);
      const footnote = screen.getByText(/report\./).closest("p");
      expect(footnote?.textContent).toContain("v2 report.");
    });
  });

  describe("RejectionContext tab", () => {
    it("sorts multiple rejection artifacts by version descending and shows source/feedback", () => {
      const artifacts = [
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "first pass feedback", source: "api" },
          { id: "rc-1", version: 1 },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, feedback: "second pass feedback", source: "linear" },
          { id: "rc-2", version: 2 },
        ),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
      expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("second pass feedback")).toBeDefined();
      expect(screen.getByText("first pass feedback")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();

      // Version 2 (most recent) should appear before version 1 in the DOM
      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings[0].textContent).toBe("Plan V2 Rejection");
      expect(headings[1].textContent).toBe("Plan V1 Rejection");
    });

    it("shows 'No rejection feedback recorded' once the active rejection tab's artifacts disappear from props", () => {
      const artifacts = [
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "feedback", source: "api" },
          { id: "rc-1", version: 1 },
        ),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

      // Replace with an artifact set that no longer has a RejectionContext,
      // but keeps at least one other artifact so the panel doesn't fall back
      // to the fully-empty state. The activeTab remains "rejectionFeedback"
      // because tab selection state persists across prop updates.
      rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "x" })]} />);

      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  it("shows 'No data available' when the active tab's artifact is removed from props on rerender", () => {
    const artifacts = [makeArtifact("Plan", { summary: "x" })];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Swap to a different artifact type; the "plan" tab (still selected in
    // internal state) no longer has a matching artifact.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Review", { verdict: "ok" })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
