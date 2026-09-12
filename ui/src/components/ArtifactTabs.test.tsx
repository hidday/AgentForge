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
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
  ),
}));

import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: `${type}-${overrides.version ?? 1}`,
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
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output/),
    ).toBeDefined();
  });

  it("renders only the tabs for which artifacts exist, in TABS order", () => {
    const artifacts = [
      makeArtifact("Review", { findings: [] }),
      makeArtifact("Plan", { steps: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    const tabButtons = screen.getAllByRole("button");
    const labels = tabButtons.map((b) => b.textContent);
    expect(labels).toEqual(["Plan", "Code Review"]);
  });

  it("defaults to the first available tab and passes its artifact payload to PlanView", () => {
    const plan = { steps: ["a", "b"] };
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", plan)]} />);
    const planView = screen.getByTestId("plan-view");
    expect(planView.textContent).toBe(JSON.stringify(plan));
  });

  it("highlights the active tab and switches content + highlight on click", async () => {
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("Review", { findings: ["x"] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });

    expect(planTab.className).toContain("bg-accent");
    expect(reviewTab.className).not.toContain("bg-accent");
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();

    await userEvent.click(reviewTab);

    expect(reviewTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ findings: ["x"] }),
    );
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("renders ExecutionReportView for the Execution tab", () => {
    const report = { score: 9 };
    render(<ArtifactTabs artifacts={[makeArtifact("ExecutionReport", report)]} />);
    expect(screen.getByTestId("execution-view").textContent).toBe(JSON.stringify(report));
  });

  it("PlanReview artifacts render through ReviewView on the Plan Review tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("PlanReview", { verdict: "approve" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ verdict: "approve" }),
    );
  });

  describe("rejection feedback tab", () => {
    it("sorts multiple rejection artifacts by version descending", async () => {
      const artifacts = [
        makeArtifact("Plan", { steps: [] }),
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "first pass feedback", source: "api" },
          { id: "rej-1", version: 1 },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, feedback: "second pass feedback", source: "linear" },
          { id: "rej-2", version: 2 },
        ),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

      const headings = screen.getAllByText(/Plan V\d Rejection/).map((el) => el.textContent);
      expect(headings).toEqual(["Plan V2 Rejection", "Plan V1 Rejection"]);
      expect(screen.getByText("second pass feedback")).toBeDefined();
      expect(screen.getByText("first pass feedback")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("shows 'No rejection feedback recorded' once the matching artifacts disappear while the tab stays active", async () => {
      const withRejection = [
        makeArtifact("Plan", { steps: [] }),
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "feedback", source: "api" },
          { id: "rej-1" },
        ),
      ];
      const { rerender } = render(<ArtifactTabs artifacts={withRejection} />);
      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

      rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { steps: [] })]} />);
      expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
    });
  });

  it("shows 'No data available' when the active tab's artifact is removed while the tab stays active", () => {
    const artifacts = [makeArtifact("Plan", { steps: [] })];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Remove the Plan artifact but add another type so the component doesn't
    // hit the fully-empty state.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Review", { findings: [] })]} />);
    expect(screen.getByText("No data available")).toBeDefined();
  });

  describe("PlanRevisionView (rendered natively by ArtifactTabs)", () => {
    it("shows 'No dispositions recorded' when the revision has none", () => {
      render(
        <ArtifactTabs artifacts={[makeArtifact("PlanRevision", { dispositions: [] })]} />,
      );
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders each disposition with its status styling and rationale", () => {
      const revision = {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Looks good" },
          { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
          { findingId: "F3", status: "partially_incorporated", rationale: "Partial fix" },
          { findingId: "F4", status: "unknown_status", rationale: "Fallback style" },
        ],
      };
      render(<ArtifactTabs artifacts={[makeArtifact("PlanRevision", revision)]} />);

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("Looks good")).toBeDefined();

      expect(screen.getByText("dismissed")).toBeDefined();
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
      expect(screen.getByText("Fallback style")).toBeDefined();
    });
  });

  describe("RemediationView (rendered natively by ArtifactTabs)", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      const remediation = {
        resolution: [
          { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "why1" },
          { findingId: "R2", status: "rejected", action: "Won't fix", rationale: "why2" },
          { findingId: "R3", status: "deferred", action: "Later", rationale: "why3" },
        ],
      };
      render(<ArtifactTabs artifacts={[makeArtifact("Remediation", remediation)]} />);

      expect(screen.getByText("R1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("Won't fix")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
    });

    it("falls back to execution version 2 when executionReport is missing", () => {
      render(
        <ArtifactTabs artifacts={[makeArtifact("Remediation", { resolution: [] })]} />,
      );
      expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();
    });

    it("uses the executionVersion from the embedded executionReport when present", () => {
      const remediation = {
        resolution: [],
        executionReport: { executionVersion: 5 },
      };
      render(<ArtifactTabs artifacts={[makeArtifact("Remediation", remediation)]} />);
      expect(screen.getByText(/open it to see the v5 report/)).toBeDefined();
    });
  });
});
