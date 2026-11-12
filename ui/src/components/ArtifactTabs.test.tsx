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
    <div data-testid="execution-view">{JSON.stringify(report)}</div>
  ),
}));

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: `${type}-${Math.random()}`,
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
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types that are present", () => {
    const artifacts = [makeArtifact("Plan", { summary: "s" })];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("defaults the active tab to the first available tab and renders its content", () => {
    const artifacts = [
      makeArtifact("Review", { overallVerdict: "approved" }),
      makeArtifact("Plan", { summary: "s" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    // Plan appears before Review in TABS order, so it should be the default active tab
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("switches tab content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan-summary" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders the PlanReview artifact through ReviewView under the Plan Review tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("PlanReview", { overallVerdict: "changes_requested" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders the ExecutionReport artifact through ExecutionReportView under the Execution tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("ExecutionReport", { summary: "exec-summary" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view")).toBeDefined();
    expect(screen.getByText(/exec-summary/)).toBeDefined();
  });

  it("renders the PlanRevision dispositions list under the Plan Revision tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Looks good" },
          { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Looks good")).toBeDefined();
    expect(screen.getByText("F2")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when PlanRevision has an empty dispositions array", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("PlanRevision", { dispositions: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders the Remediation resolutions list under the Remediation tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "done" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
  });

  it("renders the RejectionFeedback tab sorted by version descending across multiple artifacts", async () => {
    const artifacts = [
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { id: "r1", version: 1 },
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        { id: "r2", version: 2 },
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen.getAllByText(/rejection/i);
    // "Plan V2 Rejection" heading should come before "Plan V1 Rejection" (descending by version)
    const v2Index = screen.getByText("Plan V2 Rejection");
    const v1Index = screen.getByText("Plan V1 Rejection");
    expect(v2Index.compareDocumentPosition(v1Index) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(feedbackTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("does not show the Rejection Feedback tab when no RejectionContext artifact exists", () => {
    const artifacts = [makeArtifact("Plan", { summary: "s" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
  });
});
