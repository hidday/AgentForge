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

function makeArtifact(
  type: string,
  id: string,
  payloadJson: unknown,
  version = 1,
): Artifact {
  return {
    id,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/no artifacts yet — the run hasn't produced any output/i),
    ).toBeDefined();
    // No tab bar at all
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });

  it("only renders tabs for artifact types that are present, in TABS order", () => {
    const artifacts = [
      makeArtifact("ExecutionReport", "a1", { summary: "done" }),
      makeArtifact("Plan", "a2", { steps: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    // None of the other tabs exist since no matching artifacts
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan Revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
  });

  it("defaults the active tab to the first available tab (Plan)", () => {
    const artifacts = [
      makeArtifact("Review", "a1", { findings: [] }),
      makeArtifact("Plan", "a2", { steps: ["a"] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Plan comes first in TABS order, so it should be active/rendered by default
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("when the first available tab is not Plan, that tab is active by default", () => {
    const artifacts = [makeArtifact("Review", "a1", { findings: ["x"] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("clicking a different tab switches the displayed content", async () => {
    const artifacts = [
      makeArtifact("Plan", "a1", { steps: ["step1"] }),
      makeArtifact("Review", "a2", { findings: ["f1"] }),
      makeArtifact("ExecutionReport", "a3", { summary: "ok" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.queryByTestId("review-view")).toBeNull();
    expect(screen.getByTestId("execution-report-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("passes the artifact's payloadJson through to the active child component", async () => {
    const artifacts = [makeArtifact("Plan", "a1", { steps: ["step-xyz"] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view").textContent).toBe(
      JSON.stringify({ steps: ["step-xyz"] }),
    );
  });

  it("highlights the active tab button distinctly from inactive ones", async () => {
    const artifacts = [
      makeArtifact("Plan", "a1", { steps: [] }),
      makeArtifact("Review", "a2", { findings: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planBtn = screen.getByRole("button", { name: "Plan" });
    const reviewBtn = screen.getByRole("button", { name: "Code Review" });
    expect(planBtn.className).toContain("bg-accent");
    expect(reviewBtn.className).not.toContain("bg-accent");

    await userEvent.click(reviewBtn);
    expect(reviewBtn.className).toContain("bg-accent");
    expect(planBtn.className).not.toContain("bg-accent");
  });

  describe("Plan Review and Code Review share the ReviewView renderer", () => {
    it("renders the PlanReview artifact through ReviewView under the 'Plan Review' tab", () => {
      const artifacts = [makeArtifact("PlanReview", "a1", { findings: ["needs-work"] })];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
      expect(screen.getByTestId("review-view").textContent).toBe(
        JSON.stringify({ findings: ["needs-work"] }),
      );
    });
  });

  describe("Rejection Feedback tab", () => {
    it("shows only when a RejectionContext artifact exists, sorted by version descending", async () => {
      const artifacts = [
        makeArtifact(
          "RejectionContext",
          "r1",
          { planVersion: 1, feedback: "first rejection", source: "api" },
          1,
        ),
        makeArtifact(
          "RejectionContext",
          "r2",
          { planVersion: 2, feedback: "second rejection", source: "linear" },
          2,
        ),
        makeArtifact("Plan", "p1", { steps: [] }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      const tabBtn = screen.getByRole("button", { name: "Rejection Feedback" });
      await userEvent.click(tabBtn);

      expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("second rejection")).toBeDefined();
      expect(screen.getByText("first rejection")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();

      // Latest version (V2) should appear before V1 in the DOM
      const v2 = screen.getByText("Plan V2 Rejection");
      const v1 = screen.getByText("Plan V1 Rejection");
      expect(v2.compareDocumentPosition(v1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("is hidden entirely when no RejectionContext artifact exists", () => {
      render(<ArtifactTabs artifacts={[makeArtifact("Plan", "p1", { steps: [] })]} />);
      expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
    });

    it("shows the 'No rejection feedback recorded' message if the artifact disappears after being selected", async () => {
      const artifacts = [
        makeArtifact("Plan", "p1", { steps: [] }),
        makeArtifact(
          "RejectionContext",
          "r1",
          { planVersion: 1, feedback: "feedback", source: "api" },
        ),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

      // Re-render with the RejectionContext artifact removed, while the tab
      // selection (component state) is preserved.
      rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", "p1", { steps: [] })]} />);

      expect(screen.getByText(/no rejection feedback recorded/i)).toBeDefined();
    });
  });

  describe("No data available fallback", () => {
    it("shows 'No data available' if the active artifact disappears after being selected", async () => {
      const artifacts = [
        makeArtifact("Plan", "p1", { steps: [] }),
        makeArtifact("Review", "v1", { findings: [] }),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
      expect(screen.getByTestId("review-view")).toBeDefined();

      rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", "p1", { steps: [] })]} />);

      expect(screen.getByText(/no data available/i)).toBeDefined();
      expect(screen.queryByTestId("review-view")).toBeNull();
    });
  });

  describe("Plan Revision tab (rendered internally, not mocked)", () => {
    it("shows 'No dispositions recorded' when dispositions is empty/absent", () => {
      const artifacts = [makeArtifact("PlanRevision", "pr1", {})];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/no dispositions recorded/i)).toBeDefined();
    });

    it("renders each disposition with its finding id, status styling, and rationale", () => {
      const artifacts = [
        makeArtifact("PlanRevision", "pr1", {
          dispositions: [
            { findingId: "F-1", status: "accepted", rationale: "Looks good" },
            { findingId: "F-2", status: "dismissed", rationale: "Not applicable" },
            {
              findingId: "F-3",
              status: "partially_incorporated",
              rationale: "Half done",
            },
            { findingId: "F-4", status: "unknown_status", rationale: "???" },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("Looks good")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();

      expect(screen.getByText("dismissed")).toBeDefined();
      expect(screen.getByText("Not applicable")).toBeDefined();

      // Underscore-separated statuses are displayed with spaces
      expect(screen.getByText("partially incorporated")).toBeDefined();

      // Unknown status falls back to the default style but still renders
      expect(screen.getByText("unknown status")).toBeDefined();
      expect(screen.getByText("???")).toBeDefined();
    });
  });

  describe("Remediation tab (rendered internally, not mocked)", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      const artifacts = [
        makeArtifact("Remediation", "rem1", {
          resolution: [
            {
              findingId: "F-1",
              status: "accepted",
              action: "Fixed the bug",
              rationale: "Clear fix",
            },
            {
              findingId: "F-2",
              status: "rejected",
              action: "Declined",
              rationale: "Not a real issue",
            },
            {
              findingId: "F-3",
              status: "deferred",
              action: "Will handle later",
              rationale: "Low priority",
            },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("Fixed the bug")).toBeDefined();
      expect(screen.getByText("Clear fix")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();

      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("Declined")).toBeDefined();

      expect(screen.getByText("deferred")).toBeDefined();
      expect(screen.getByText("Will handle later")).toBeDefined();
    });

    it("falls back to executionVersion 2 in the footer note when none is provided", () => {
      const artifacts = [makeArtifact("Remediation", "rem1", { resolution: [] })];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/report\./i)).toBeDefined();
      expect(screen.getByText(/v\s*2\s*report/i)).toBeDefined();
    });

    it("uses the provided executionReport.executionVersion in the footer note", () => {
      const artifacts = [
        makeArtifact("Remediation", "rem1", {
          resolution: [],
          executionReport: { executionVersion: 5 },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/v\s*5\s*report/i)).toBeDefined();
    });
  });
});
