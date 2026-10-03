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
    id: overrides.id ?? `${type}-${Math.random()}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: "",
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no matching artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types present, and activates the first one by default", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "the plan" }),
      makeArtifact("Review", { verdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    // Tabs with no matching artifact are not rendered
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan Revision" })).toBeNull();

    // First available tab (Plan) is active by default
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Plan" }).className).toContain("bg-accent");
    expect(screen.getByRole("button", { name: "Code Review" }).className).not.toContain(
      "bg-accent",
    );
  });

  it("switches the active tab and its styling when another tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "the plan" }),
      makeArtifact("Review", { verdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByTestId("review-view")).toBeDefined();
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Code Review" }).className).toContain("bg-accent");
    expect(screen.getByRole("button", { name: "Plan" }).className).not.toContain("bg-accent");
  });

  it("passes the parsed artifact payload through to the Plan/Review/Execution views", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan payload" }),
      makeArtifact("ExecutionReport", { status: "ok" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view").textContent).toContain("plan payload");

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view").textContent).toContain("ok");
  });

  it("shows 'No data available' when the active tab's artifact disappears after a prop update", () => {
    const withPlan = [makeArtifact("Plan", { summary: "p" }), makeArtifact("Review", {})];
    const { rerender } = render(<ArtifactTabs artifacts={withPlan} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    // Re-render with the Plan artifact removed; activeTab state stays "plan" even
    // though the Plan tab button no longer renders, so the content area falls
    // through to the generic "No data available" branch.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Review", {})]} />);

    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.getByText(/No data available/i)).toBeDefined();
  });

  it("shows rejection feedback entries sorted by version descending, with their source badges", async () => {
    const artifacts = [
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "first pass feedback", source: "api" },
        { id: "r1", version: 1 },
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "second pass feedback", source: "linear" },
        { id: "r2", version: 2 },
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("second pass feedback")).toBeDefined();
    expect(screen.getByText("first pass feedback")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();

    // Verify sort order: V2 entry appears before V1 entry in the DOM
    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
  });

  it("shows 'No rejection feedback recorded' when the active tab is rejectionFeedback but no matching artifacts remain after a prop update", async () => {
    const withRejection = [
      makeArtifact("Plan", { summary: "p" }),
      makeArtifact("RejectionContext", { planVersion: 1, feedback: "fb", source: "api" }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={withRejection} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

    // Re-render with the rejection artifact removed; activeTab state persists as
    // "rejectionFeedback" even though that tab button no longer renders.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "p" })]} />);

    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
    expect(screen.getByText(/No rejection feedback recorded/i)).toBeDefined();
  });

  it("renders PlanRevision disposition status badges for each known status and the default fallback", () => {
    const artifacts = [
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "looks good" },
          { findingId: "F2", status: "dismissed", rationale: "not applicable" },
          { findingId: "F3", status: "partially_incorporated", rationale: "partial" },
          { findingId: "F4", status: "unknown_status", rationale: "weird" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("renders the Remediation view with resolutions and the execution-version footer fallback", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "R1", status: "accepted", action: "fixed it", rationale: "ok" },
          { findingId: "R2", status: "rejected", action: "ignored it", rationale: "no" },
          { findingId: "R3", status: "other", action: "deferred", rationale: "later" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("fixed it")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("other")).toBeDefined();
    // No executionReport provided -> falls back to version 2 in the footer text
    expect(screen.getByText(/the v2 report\./i)).toBeDefined();
  });

  it("renders the Remediation view's executionVersion from the payload when provided", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/the v5 report\./i)).toBeDefined();
  });
});
