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

let idCounter = 0;
function makeArtifact(
  type: string,
  payloadJson: unknown,
  version = 1,
): Artifact {
  idCounter += 1;
  return {
    id: `art-${idCounter}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: `2024-01-01T00:00:0${idCounter}Z`,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet.*hasn't produced any output/),
    ).toBeDefined();
  });

  it("defaults to the first available tab in TABS order and renders the matching child", () => {
    const artifacts = [
      makeArtifact("Review", { overallVerdict: "approved" }),
      makeArtifact("Plan", { summary: "plan summary" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Plan comes before Review in TABS order, so it should be the default tab
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();

    // Only tabs for present artifact types are shown
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("switches rendered content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan summary" }),
      makeArtifact("ExecutionReport", { summary: "exec summary" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("execution-report-view")).toBeDefined();
  });

  it("renders ReviewView for both the PlanReview and Review tabs", async () => {
    const artifacts = [
      makeArtifact("PlanReview", { overallVerdict: "approved" }),
      makeArtifact("Review", { overallVerdict: "changes_requested" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Default tab is PlanReview (comes first in TABS order)
    expect(screen.getByTestId("review-view").textContent).toContain("approved");

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain(
      "changes_requested",
    );
  });

  it("shows 'No data available' when the active tab's artifact disappears from props but other artifacts remain", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan summary" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
    // Default tab is Plan (first in TABS order)
    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Re-render with the Plan artifact removed; the Plan tab stays selected
    // internally even though its button and data are now gone.
    rerender(
      <ArtifactTabs artifacts={[makeArtifact("Review", { overallVerdict: "approved" })]} />,
    );

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByText("No data available")).toBeDefined();
    // The Plan tab button itself is no longer shown
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });

  describe("Rejection Feedback tab", () => {
    it("sorts rejection artifacts by descending version and renders each one's details", async () => {
      const artifacts = [
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, source: "api", feedback: "First rejection" },
          1,
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 3, source: "linear", feedback: "Third rejection" },
          3,
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, source: "api", feedback: "Second rejection" },
          2,
        ),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(
        screen.getByRole("button", { name: "Rejection Feedback" }),
      );

      expect(screen.getByText("Plan V3 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("Third rejection")).toBeDefined();
      expect(screen.getByText("Second rejection")).toBeDefined();
      expect(screen.getByText("First rejection")).toBeDefined();
      expect(screen.getAllByText("linear").length).toBe(1);
      expect(screen.getAllByText("api").length).toBe(2);

      // Assert descending order in the DOM
      const headings = screen
        .getAllByText(/Plan V\d Rejection/)
        .map((el) => el.textContent);
      expect(headings).toEqual([
        "Plan V3 Rejection",
        "Plan V2 Rejection",
        "Plan V1 Rejection",
      ]);
    });

    it("shows the 'no rejection feedback' empty state when rejection artifacts disappear while the tab is active", async () => {
      const artifacts = [
        makeArtifact("RejectionContext", {
          planVersion: 1,
          source: "api",
          feedback: "Feedback",
        }),
        // Keep another type present so the component doesn't fall back to the
        // fully-empty "No artifacts yet" state after the rerender below.
        makeArtifact("Plan", { summary: "keep artifacts non-empty" }),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(
        screen.getByRole("button", { name: "Rejection Feedback" }),
      );
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

      rerender(
        <ArtifactTabs
          artifacts={[makeArtifact("Plan", { summary: "keep artifacts non-empty" })]}
        />,
      );

      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  describe("Plan Revision tab (PlanRevisionView)", () => {
    it("shows the empty-state message when dispositions is empty", async () => {
      const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("applies the correct status style per disposition, falling back for unrecognized statuses", async () => {
      const artifacts = [
        makeArtifact("PlanRevision", {
          dispositions: [
            { findingId: "f1", status: "accepted", rationale: "Fixed it" },
            { findingId: "f2", status: "dismissed", rationale: "Not applicable" },
            {
              findingId: "f3",
              status: "partially_incorporated",
              rationale: "Partly done",
            },
            { findingId: "f4", status: "unknown_status", rationale: "Unclear" },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

      expect(screen.getByText("Review Finding Dispositions")).toBeDefined();

      const accepted = screen.getByText("accepted");
      expect(accepted.className).toContain("bg-state-done-bg");

      const dismissed = screen.getByText("dismissed");
      expect(dismissed.className).toContain("bg-state-blocked-bg");

      // underscore replaced with space
      const partial = screen.getByText("partially incorporated");
      expect(partial.className).toContain("bg-state-waiting-bg");

      const unknownStatus = screen.getByText("unknown status");
      expect(unknownStatus.className).toContain("bg-surface-hover");
      expect(unknownStatus.className).toContain("text-text-muted");

      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("Not applicable")).toBeDefined();
      expect(screen.getByText("Partly done")).toBeDefined();
      expect(screen.getByText("Unclear")).toBeDefined();
    });
  });

  describe("Remediation tab (RemediationView)", () => {
    it("applies the correct status style per resolution and falls back the executionVersion to 2 when absent", async () => {
      const artifacts = [
        makeArtifact("Remediation", {
          resolution: [
            {
              findingId: "f1",
              status: "accepted",
              action: "Patched null check",
              rationale: "Was a real bug",
            },
            {
              findingId: "f2",
              status: "rejected",
              action: "No change",
              rationale: "Not a real issue",
            },
            {
              findingId: "f3",
              status: "deferred",
              action: "Will do later",
              rationale: "Low priority",
            },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

      const accepted = screen.getByText("accepted");
      expect(accepted.className).toContain("bg-state-done-bg");
      const rejected = screen.getByText("rejected");
      expect(rejected.className).toContain("bg-state-blocked-bg");
      const deferred = screen.getByText("deferred");
      expect(deferred.className).toContain("bg-state-waiting-bg");

      expect(screen.getByText("Patched null check")).toBeDefined();
      expect(screen.getByText("Was a real bug")).toBeDefined();
      expect(screen.getByText("No change")).toBeDefined();
      expect(screen.getByText("Not a real issue")).toBeDefined();
      expect(screen.getByText("Will do later")).toBeDefined();
      expect(screen.getByText("Low priority")).toBeDefined();

      // executionReport absent -> footer falls back to v2
      expect(screen.getByText(/the v2 report\./)).toBeDefined();
    });

    it("uses the report's executionVersion in the footer when present", async () => {
      const artifacts = [
        makeArtifact("Remediation", {
          resolution: [],
          executionReport: { executionVersion: 5 },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

      expect(screen.getByText(/the v5 report\./)).toBeDefined();
    });
  });
});
