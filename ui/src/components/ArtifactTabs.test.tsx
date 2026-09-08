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

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "art-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
  });

  it("shows the empty state when no artifacts match any known tab type", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "SomethingUnknown" })]}
      />,
    );
    expect(screen.getByText(/No artifacts yet/i)).toBeDefined();
  });

  it("renders only tabs with matching artifacts, defaulting to the first available tab", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "plan!" } }),
          makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { ok: true } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();

    // Defaults to the first available tab (Plan)
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.getByTestId("plan-view").textContent).toContain("plan!");
  });

  it("switches tabs on click and shows the correct content per tab, including shared ReviewView for planReview/review", async () => {
    const user = userEvent.setup();
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { x: 1 } }),
          makeArtifact({ id: "a2", type: "PlanReview", payloadJson: { verdict: "changes_requested" } }),
          makeArtifact({ id: "a3", type: "Review", payloadJson: { verdict: "approved" } }),
          makeArtifact({ id: "a4", type: "ExecutionReport", payloadJson: { score: 9 } }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("changes_requested");

    await user.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain("approved");

    await user.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view").textContent).toContain("9");

    await user.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByTestId("plan-view").textContent).toContain('"x":1');
  });

  it("applies active styling to the selected tab button", async () => {
    const user = userEvent.setup();
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan" }),
          makeArtifact({ id: "a2", type: "ExecutionReport" }),
        ]}
      />,
    );
    const planBtn = screen.getByRole("button", { name: "Plan" });
    const execBtn = screen.getByRole("button", { name: "Execution" });
    expect(planBtn.className).toContain("bg-accent");
    expect(execBtn.className).not.toContain("bg-accent");

    await user.click(execBtn);
    expect(execBtn.className).toContain("bg-accent");
    expect(planBtn.className).not.toContain("bg-accent");
  });

  it("renders PlanRevisionView with dispositions, mapping each status to its style and formatting the status label", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Good point" },
                { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
                {
                  findingId: "F3",
                  status: "partially_incorporated",
                  rationale: "Partially done",
                },
                { findingId: "F4", status: "unknown_status", rationale: "Fallback style" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    // underscores replaced with spaces
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
    expect(screen.getByText("Good point")).toBeDefined();
  });

  it("shows the empty-dispositions message for PlanRevision with no dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders RemediationView with resolutions across all status styles and a default executionVersion of 2", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "Because" },
                { findingId: "R2", status: "rejected", action: "Won't fix", rationale: "Out of scope" },
                { findingId: "R3", status: "deferred", action: "Later", rationale: "Low priority" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("deferred")).toBeDefined();
    expect(screen.getByText(/open it to see the v2 report\./)).toBeDefined();
  });

  it("renders RemediationView with an explicit executionVersion from the payload", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "Remediation",
            payloadJson: {
              resolution: [],
              executionReport: { executionVersion: 5 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/open it to see the v5 report\./)).toBeDefined();
  });

  it("renders RejectionFeedbackView sorted descending by version with source badges", () => {
    render(
      <ArtifactTabs
        artifacts={[
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
        ]}
      />,
    );

    // Default tab is the first available (rejectionFeedback here, since it's
    // the only artifact type present)
    const items = screen.getAllByText(/Plan V\d Rejection/);
    expect(items[0].textContent).toContain("Plan V2 Rejection");
    expect(items[1].textContent).toContain("Plan V1 Rejection");
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
  });

  it("shows 'No data available' when the previously active tab's artifact disappears from props", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan" }),
          makeArtifact({ id: "a2", type: "ExecutionReport" }),
        ]}
      />,
    );
    // Switch to Execution tab, then remove the Execution artifact via rerender —
    // activeTab state ("execution") is preserved but no matching artifact remains.
    await user.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact({ id: "a1", type: "Plan" })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
    // Only the Plan tab button remains visible now
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("shows 'No rejection feedback recorded' when the active rejectionFeedback tab's artifacts disappear from props", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan" }),
          makeArtifact({
            id: "r1",
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "fb", source: "api" },
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact({ id: "a1", type: "Plan" })]} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });
});
