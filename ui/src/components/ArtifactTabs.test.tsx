import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
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

function makeArtifact(overrides: Partial<Artifact>): Artifact {
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

  it("renders only tabs for artifact types that are present, defaulting to the first available", () => {
    const artifacts = [
      makeArtifact({ id: "p1", type: "Plan", payloadJson: { summary: "S" } }),
      makeArtifact({ id: "r1", type: "Review", payloadJson: { summary: "R" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();

    // Plan tab (first in TABS order) is active by default
    expect(screen.getByTestId("plan-view").textContent).toBe(
      JSON.stringify({ summary: "S" }),
    );
  });

  it("switches tabs on click and renders the matching artifact content", async () => {
    const artifacts = [
      makeArtifact({ id: "p1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "r1", type: "Review", payloadJson: { summary: "Review summary" } }),
      makeArtifact({
        id: "e1",
        type: "ExecutionReport",
        payloadJson: { summary: "Exec summary" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ summary: "Review summary" }),
    );
    expect(screen.queryByTestId("plan-view")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-report-view").textContent).toBe(
      JSON.stringify({ summary: "Exec summary" }),
    );
    expect(screen.queryByTestId("review-view")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("routes PlanReview artifacts through ReviewView (shared component)", () => {
    const artifacts = [
      makeArtifact({ id: "pr1", type: "PlanReview", payloadJson: { overallVerdict: "approved" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify({ overallVerdict: "approved" }),
    );
  });

  it("renders a PlanRevision artifact's dispositions with status styling and formatted status text", () => {
    const artifacts = [
      makeArtifact({
        id: "pv1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Makes sense." },
            { findingId: "F2", status: "dismissed", rationale: "Not applicable." },
            {
              findingId: "F3",
              status: "partially_incorporated",
              rationale: "Partly addressed.",
            },
            { findingId: "F4", status: "weird_status", rationale: "Fallback style." },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird_status".replace(/_/g, " "))).toBeDefined();
    expect(screen.getByText("Makes sense.")).toBeDefined();
  });

  it("shows a 'No dispositions recorded' message when a PlanRevision has none", () => {
    const artifacts = [
      makeArtifact({ id: "pv1", type: "PlanRevision", payloadJson: { dispositions: [] } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when the dispositions field is missing entirely", () => {
    const artifacts = [
      makeArtifact({ id: "pv1", type: "PlanRevision", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders a Remediation artifact's resolutions with status styling and executionVersion fallback", () => {
    const artifacts = [
      makeArtifact({
        id: "rem1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "Because." },
            { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "n/a" },
            { findingId: "F3", status: "deferred", action: "Later", rationale: "low prio" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("deferred")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    // Falls back to v2 when the remediation payload has no executionReport.executionVersion
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("renders no resolution rows (without crashing) when the resolution field is missing entirely", () => {
    const artifacts = [makeArtifact({ id: "rem1", type: "Remediation", payloadJson: {} })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("renders the explicit executionReport.executionVersion in the Remediation footnote when present", () => {
    const artifacts = [
      makeArtifact({
        id: "rem1",
        type: "Remediation",
        payloadJson: {
          resolution: [],
          executionReport: { executionVersion: 5 },
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/v5/)).toBeDefined();
  });

  it("renders multiple RejectionContext artifacts sorted by version descending", () => {
    const artifacts = [
      makeArtifact({
        id: "rc1",
        type: "RejectionContext",
        payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
      }),
      makeArtifact({
        id: "rc2",
        type: "RejectionContext",
        payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Only tab available is "Rejection Feedback" -> active by default
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });
});
