import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mock the child view components so this file focuses on ArtifactTabs' own
// tab-switching/routing logic (PlanView, ReviewView, ExecutionReportView
// each have their own dedicated test files).
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

import { ArtifactTabs } from "./ArtifactTabs.tsx";

let idCounter = 0;
function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  idCounter += 1;
  return {
    id: overrides.id ?? `artifact-${idCounter}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet/i),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types that are present, and defaults to the first available tab", () => {
    const artifacts = [
      makeArtifact("Review", { overallVerdict: "approved" }),
      makeArtifact("Plan", { summary: "plan summary" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Only Plan and Code Review tabs should be rendered (order follows TABS order)
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();

    // Plan comes first in TABS, so it should be the default active tab
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();

    const planTabBtn = screen.getByRole("button", { name: "Plan" });
    expect(planTabBtn.className).toContain("bg-accent");
    expect(planTabBtn.className).toContain("text-white");

    const reviewTabBtn = screen.getByRole("button", { name: "Code Review" });
    expect(reviewTabBtn.className).not.toContain("bg-accent");
  });

  it("switches the active tab and content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "the plan" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();

    const reviewTabBtn = screen.getByRole("button", { name: "Code Review" });
    expect(reviewTabBtn.className).toContain("bg-accent");
    const planTabBtn = screen.getByRole("button", { name: "Plan" });
    expect(planTabBtn.className).not.toContain("bg-accent");
  });

  it("passes the artifact's payloadJson through to PlanView", () => {
    const payload = { summary: "specific plan payload", planVersion: 7 };
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", payload)]} />);
    expect(screen.getByTestId("plan-view").textContent).toBe(
      JSON.stringify(payload),
    );
  });

  it("routes a 'PlanReview' artifact type to the Plan Review tab using ReviewView", async () => {
    const payload = { overallVerdict: "changes_requested" };
    render(<ArtifactTabs artifacts={[makeArtifact("PlanReview", payload)]} />);
    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify(payload),
    );
  });

  it("routes an 'ExecutionReport' artifact to the Execution tab using ExecutionReportView", () => {
    const payload = { summary: "executed" };
    render(
      <ArtifactTabs artifacts={[makeArtifact("ExecutionReport", payload)]} />,
    );
    expect(screen.getByTestId("execution-view").textContent).toBe(
      JSON.stringify(payload),
    );
  });

  it("shows 'No data available' when the active tab's artifact disappears on rerender", () => {
    const planArtifact = makeArtifact("Plan", { summary: "plan" });
    const reviewArtifact = makeArtifact("Review", { overallVerdict: "approved" });

    const { rerender } = render(
      <ArtifactTabs artifacts={[planArtifact, reviewArtifact]} />,
    );

    // Default active tab is "Plan" (first in TABS order), rendering plan-view
    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Now rerender without the Plan artifact — active tab state ("plan")
    // persists, but there's no longer a matching artifact for it.
    rerender(<ArtifactTabs artifacts={[reviewArtifact]} />);

    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.getByText(/No data available/i)).toBeDefined();
  });

  describe("PlanRevision tab", () => {
    it("shows 'No dispositions recorded' when dispositions is empty", () => {
      render(
        <ArtifactTabs artifacts={[makeArtifact("PlanRevision", { dispositions: [] })]} />,
      );
      expect(screen.getByText(/No dispositions recorded/i)).toBeDefined();
    });

    it("renders dispositions with styled status badges for each known status", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("PlanRevision", {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "Makes sense." },
                { findingId: "f2", status: "dismissed", rationale: "Not applicable." },
                {
                  findingId: "f3",
                  status: "partially_incorporated",
                  rationale: "Took part of it.",
                },
                { findingId: "f4", status: "unknown_status", rationale: "Fallback case." },
              ],
            }),
          ]}
        />,
      );

      expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
      expect(screen.getByText("f1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("Makes sense.")).toBeDefined();

      expect(screen.getByText("f2")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();

      expect(screen.getByText("f3")).toBeDefined();
      // status.replace(/_/g, " ") turns "partially_incorporated" into "partially incorporated"
      expect(screen.getByText("partially incorporated")).toBeDefined();

      expect(screen.getByText("f4")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("Remediation", {
              resolution: [
                {
                  findingId: "r1",
                  status: "accepted",
                  action: "Fixed the bug.",
                  rationale: "Was a real issue.",
                },
                {
                  findingId: "r2",
                  status: "rejected",
                  action: "No change made.",
                  rationale: "Not a real issue.",
                },
                {
                  findingId: "r3",
                  status: "deferred",
                  action: "Will handle later.",
                  rationale: "Out of scope for now.",
                },
              ],
            }),
          ]}
        />,
      );

      expect(screen.getByText("Resolutions")).toBeDefined();
      expect(screen.getByText("r1")).toBeDefined();
      expect(screen.getByText("Fixed the bug.")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();

      expect(screen.getByText("r2")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();

      expect(screen.getByText("r3")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();

      // Defaults to v2 when executionReport.executionVersion is missing
      expect(screen.getByText(/the latest Execution tab/i).textContent).toContain(
        "v2 report",
      );
    });

    it("references the actual execution version when provided on the remediation artifact", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("Remediation", {
              resolution: [],
              executionReport: { executionVersion: 5 },
            }),
          ]}
        />,
      );
      expect(screen.getByText(/the latest Execution tab/i).textContent).toContain(
        "v5 report",
      );
    });
  });

  describe("Rejection Feedback tab", () => {
    it("renders multiple rejection feedback entries sorted descending by plan version", async () => {
      const artifacts = [
        makeArtifact(
          "Plan",
          { summary: "plan" },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "First rejection", source: "api" },
          { id: "rej-1" },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, feedback: "Second rejection", source: "linear" },
          { id: "rej-2", version: 2 },
        ),
      ];

      render(<ArtifactTabs artifacts={artifacts} />);

      await userEvent.click(
        screen.getByRole("button", { name: "Rejection Feedback" }),
      );

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings).toHaveLength(2);
      // Descending by version: V2 should come before V1 in the DOM
      expect(headings[0].textContent).toBe("Plan V2 Rejection");
      expect(headings[1].textContent).toBe("Plan V1 Rejection");

      expect(screen.getByText("First rejection")).toBeDefined();
      expect(screen.getByText("Second rejection")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("shows 'No rejection feedback recorded' once the only rejection artifact is removed on rerender", async () => {
      const planArtifact = makeArtifact("Plan", { summary: "plan" });
      const rejectionArtifact = makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "Only rejection", source: "api" },
        { id: "rej-only" },
      );

      const { rerender } = render(
        <ArtifactTabs artifacts={[planArtifact, rejectionArtifact]} />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Rejection Feedback" }),
      );
      expect(screen.getByText("Only rejection")).toBeDefined();

      // Remove the RejectionContext artifact while keeping Plan so the tab
      // bar still has at least one tab (availableTabs stays non-empty).
      rerender(<ArtifactTabs artifacts={[planArtifact]} />);

      expect(screen.getByText(/No rejection feedback recorded/i)).toBeDefined();
    });
  });
});
