import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
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
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan" }),
          makeArtifact({ id: "a2", type: "Review" }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan Revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content via PlanView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "s" } })]}
      />,
    );

    expect(screen.getByTestId("plan-view").textContent).toContain("summary");
  });

  it("switches tabs on click and renders the newly selected tab's content", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "plan summary" } }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "review summary" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view").textContent).toContain("review summary");
  });

  it("applies active styling to the selected tab button and not to others", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan" }),
          makeArtifact({ id: "a2", type: "Review" }),
        ]}
      />,
    );

    const planBtn = screen.getByRole("button", { name: "Plan" });
    const reviewBtn = screen.getByRole("button", { name: "Code Review" });
    expect(planBtn.className).toContain("bg-accent");
    expect(reviewBtn.className).not.toContain("bg-accent");

    await userEvent.click(reviewBtn);
    expect(reviewBtn.className).toContain("bg-accent");
    expect(planBtn.className).not.toContain("bg-accent");
  });

  it("uses PlanReview artifact rendered through ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanReview", payloadJson: { summary: "pr summary" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("review-view").textContent).toContain("pr summary");
  });

  it("renders Execution artifact through ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "ExecutionReport", payloadJson: { summary: "exec" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("execution-view").textContent).toContain("exec");
  });

  it("renders PlanRevision dispositions when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Good point" },
                { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
                { findingId: "F3", status: "partially_incorporated", rationale: "Partially addressed" },
                { findingId: "F4", status: "other", rationale: "Other status" },
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
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("other")).toBeDefined();
    expect(screen.getByText("Good point")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when PlanRevision has an empty dispositions array", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]}
      />,
    );

    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and the default executionVersion fallback", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "Because" },
                { findingId: "R2", status: "rejected", action: "Won't fix", rationale: "Out of scope" },
                { findingId: "R3", status: "pending", action: "Investigating", rationale: "TBD" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("pending")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    // No executionReport in payload -> falls back to v2
    expect(screen.getByText(/v\s*2\s*report\./)).toBeDefined();
  });

  it("renders the Remediation executionVersion from the embedded executionReport when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [],
              executionReport: { executionVersion: 5 },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText(/v\s*5\s*report\./)).toBeDefined();
  });

  it("shows the newest rejection feedback first and includes the source badge", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
  });

  it("shows 'No rejection feedback recorded' if the selected rejection tab's artifacts disappear on rerender", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "Feedback", source: "api" },
          }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("falls back to 'No data available' if the selected tab's artifact disappears on rerender", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan" }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "r" } }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
