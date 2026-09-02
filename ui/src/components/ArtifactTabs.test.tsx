import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

vi.mock("./PlanView.tsx", () => ({
  PlanView: ({ plan }: { plan: unknown }) => (
    <div data-testid="plan-view">{JSON.stringify(plan)}</div>
  ),
}));
vi.mock("./ReviewView.tsx", () => ({
  ReviewView: ({ review }: { review: unknown }) => (
    <div data-testid="review-view">{JSON.stringify(review)}</div>
  ),
}));
vi.mock("./ExecutionReportView.tsx", () => ({
  ExecutionReportView: ({ report }: { report: unknown }) => (
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
  ),
}));

import { ArtifactTabs } from "./ArtifactTabs.tsx";

let idCounter = 0;
function makeArtifact(
  type: string,
  payload: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  idCounter += 1;
  return {
    id: `artifact-${idCounter}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/No artifacts yet/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only the tab(s) for artifact types that are present, defaulting to the first available", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Review", { summary: "s" })]} />);
    // Only the "Code Review" tab should be present (no Plan tab).
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    // And it should be selected by default since it's the only available tab.
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders all seven tabs when every artifact type is present, defaulting to Plan", () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanReview", { overallVerdict: "approved" }),
      makeArtifact("PlanRevision", { dispositions: [] }),
      makeArtifact("ExecutionReport", { executionVersion: 1 }),
      makeArtifact("Review", { overallVerdict: "approved" }),
      makeArtifact("Remediation", { resolution: [] }),
      makeArtifact("RejectionContext", { planVersion: 1, feedback: "no", source: "api" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    for (const label of [
      "Plan",
      "Plan Review",
      "Plan Revision",
      "Execution",
      "Code Review",
      "Remediation",
      "Rejection Feedback",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }

    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches content and active styling when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("ExecutionReport", { executionVersion: 5 }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const execTab = screen.getByRole("button", { name: "Execution" });
    expect(planTab.className).toContain("bg-accent");
    expect(execTab.className).not.toContain("bg-accent");

    await userEvent.click(execTab);

    expect(screen.getByTestId("execution-view").textContent).toContain('"executionVersion":5');
    expect(execTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("routes both PlanReview and Review artifact types through ReviewView with their own payload", async () => {
    const artifacts = [
      makeArtifact("PlanReview", { overallVerdict: "approved", summary: "plan review" }),
      makeArtifact("Review", { overallVerdict: "changes_requested", summary: "code review" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("review-view").textContent).toContain("plan review");

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("code review");
  });

  describe("Plan Revision (local view)", () => {
    it("renders each disposition's finding id, humanised status and rationale", () => {
      const artifacts = [
        makeArtifact("PlanRevision", {
          dispositions: [
            { findingId: "f1", status: "accepted", rationale: "Good fix" },
            { findingId: "f2", status: "dismissed", rationale: "Not applicable" },
            {
              findingId: "f3",
              status: "partially_incorporated",
              rationale: "Partially done",
            },
            { findingId: "f4", status: "unknown_status", rationale: "Fallback style" },
          ],
        }),
      ];
      const { container } = render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
      expect(screen.getByText("f1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("Good fix")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      expect(screen.getByText("partially incorporated")).toBeDefined();
      const fallback = screen.getByText("unknown status");
      expect(fallback.className).toContain("bg-surface-hover");
      expect(container).toBeDefined();
    });

    it("shows a 'no dispositions' message when the list is empty", () => {
      const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });
  });

  describe("Remediation (local view)", () => {
    it("renders resolutions with accepted/rejected/other styling and the execution version footnote", () => {
      const artifacts = [
        makeArtifact("Remediation", {
          resolution: [
            {
              findingId: "f1",
              status: "accepted",
              action: "Fixed the injection.",
              rationale: "Added parameterized query.",
            },
            {
              findingId: "f2",
              status: "rejected",
              action: "Left the naming as-is.",
              rationale: "Matches existing convention.",
            },
            {
              findingId: "f3",
              status: "deferred",
              action: "Will address later.",
              rationale: "Out of scope for this run.",
            },
          ],
          executionReport: { executionVersion: 3 },
        }),
      ];
      const { container } = render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("Resolutions")).toBeDefined();
      expect(screen.getByText("Fixed the injection.")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      expect(container.textContent).toContain("v3");
      expect(container.textContent).toContain("report.");
    });

    it("defaults the footnote's execution version to 2 when no executionReport is present", () => {
      const artifacts = [makeArtifact("Remediation", { resolution: [] })];
      const { container } = render(<ArtifactTabs artifacts={artifacts} />);
      expect(container.textContent).toContain("v2");
    });
  });

  describe("Rejection Feedback (local view)", () => {
    it("sorts rejection artifacts by version descending and shows source + feedback", () => {
      const artifacts = [
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "First rejection reason", source: "api" },
          { version: 1 },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, feedback: "Second rejection reason", source: "linear" },
          { version: 2 },
        ),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      const entries = screen.getAllByText(/^Plan V\d Rejection$/);
      expect(entries.map((e) => e.textContent)).toEqual([
        "Plan V2 Rejection",
        "Plan V1 Rejection",
      ]);
      expect(screen.getByText("First rejection reason")).toBeDefined();
      expect(screen.getByText("Second rejection reason")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });
  });

  it("shows 'No data available' when the active tab's artifact is removed from props while selected", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { planVersion: 1 })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("shows 'No rejection feedback recorded' when rejection artifacts are removed while that tab is selected", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("RejectionContext", { planVersion: 1, feedback: "reason", source: "api" }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("reason")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { planVersion: 1 })]} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
  });
});
