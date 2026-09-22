import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
  ),
}));

import { ArtifactTabs } from "./ArtifactTabs.tsx";

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
  it("shows an empty state and no tabs when there are no matching artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only the tabs for artifact types that are present, defaulting to the first", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { steps: [] } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { overallVerdict: "approve" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Defaults to the first available tab (Plan)
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("switches the active view and passes the matching artifact's payload when a tab is clicked", async () => {
    const planPayload = { steps: [{ id: "s1", title: "Step", description: "d" }] };
    const reviewPayload = { overallVerdict: "changes_requested" };
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: planPayload }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: reviewPayload }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view").textContent).toBe(JSON.stringify(planPayload));

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view").textContent).toBe(JSON.stringify(reviewPayload));
  });

  it("uses the ReviewView for both PlanReview and Review artifact types", async () => {
    const planReviewPayload = { overallVerdict: "approve", stage: "plan" };
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: {} }),
      makeArtifact({ id: "a2", type: "PlanReview", payloadJson: planReviewPayload }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view").textContent).toBe(
      JSON.stringify(planReviewPayload),
    );
  });

  it("renders the ExecutionReportView for the Execution tab", async () => {
    const reportPayload = { summary: "done", filesChanged: ["a.ts"] };
    const artifacts = [
      makeArtifact({ id: "a1", type: "ExecutionReport", payloadJson: reportPayload }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("execution-view").textContent).toBe(
      JSON.stringify(reportPayload),
    );
  });

  it("renders plan revision dispositions with the correct status label and styling", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Good point" },
            { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
            {
              findingId: "F3",
              status: "partially_incorporated",
              rationale: "Some of it",
            },
            { findingId: "F4", status: "weird_status", rationale: "fallback" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    // Underscores are replaced with spaces for display
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird status")).toBeDefined();
    expect(screen.getByText("Good point")).toBeDefined();

    const acceptedBadge = screen.getByText("accepted");
    expect(acceptedBadge.className).toContain("bg-state-done-bg");
    const dismissedBadge = screen.getByText("dismissed");
    expect(dismissedBadge.className).toContain("bg-state-blocked-bg");
    const partialBadge = screen.getByText("partially incorporated");
    expect(partialBadge.className).toContain("bg-state-waiting-bg");
    const fallbackBadge = screen.getByText("weird status");
    expect(fallbackBadge.className).toContain("bg-surface-hover");
  });

  it("shows an empty-dispositions message for a PlanRevision artifact with no dispositions", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions with status styling and the execution version footer", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "r1" },
            { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "r2" },
            { findingId: "F3", status: "other", action: "Deferred", rationale: "r3" },
          ],
          executionReport: { executionVersion: 3 },
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("other")).toBeDefined();
    expect(screen.getByText(/v3 report/)).toBeDefined();
  });

  it("falls back to execution version 2 in the remediation footer when none is provided", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: { resolution: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/v2 report/)).toBeDefined();
  });

  it("shows rejection feedback sorted by version descending, with source badges", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: {} }),
      makeArtifact({
        id: "r1",
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
      }),
      makeArtifact({
        id: "r2",
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen
      .getAllByText(/rejection$/)
      .map((el) => el.textContent);
    expect(feedbackTexts).toEqual(["Second rejection", "First rejection"]);
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });
});
