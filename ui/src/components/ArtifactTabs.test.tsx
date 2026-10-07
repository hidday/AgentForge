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
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("defaults to the first available tab and renders its content", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "s" } }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "r" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.getByTestId("plan-view").textContent).toContain("s");
  });

  it("switches the rendered content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "plan-content" } }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "review-content" } }),
        ]}
      />,
    );

    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view").textContent).toContain("review-content");

    // The active tab button should carry the active styling
    expect(screen.getByRole("button", { name: "Code Review" }).className).toContain("bg-accent");
    expect(screen.getByRole("button", { name: "Plan" }).className).not.toContain("bg-accent");
  });

  it("shows 'No data available' when the active tab's artifact disappears after an update", () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "ExecutionReport", payloadJson: { summary: "exec" } }),
        ]}
      />,
    );
    expect(screen.getByTestId("execution-view")).toBeDefined();

    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } })]}
      />,
    );

    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("renders a dedicated Plan Revision view with disposition status styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Fixed as suggested." },
                { findingId: "F2", status: "dismissed", rationale: "Not applicable." },
                {
                  findingId: "F3",
                  status: "partially_incorporated",
                  rationale: "Partially addressed.",
                },
                { findingId: "F4", status: "unhandled_status", rationale: "Weird one." },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unhandled status")).toBeDefined();
    expect(screen.getByText("Fixed as suggested.")).toBeDefined();
  });

  it("shows a 'No dispositions recorded' message for an empty plan revision", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders a Remediation view with resolution statuses and a default execution version of 2", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "r1" },
                { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "r2" },
                { findingId: "F3", status: "deferred", action: "Later", rationale: "r3" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("Won't fix")).toBeDefined();
    expect(screen.getByText(/the updated implementation/)).toBeDefined();
    expect(screen.getByText(/v2/).textContent).toContain("v2");
  });

  it("renders the Remediation view's execution version when the execution report is present", () => {
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
    expect(screen.getByText(/v5/).textContent).toContain("v5");
  });

  it("renders rejection feedback sorted by plan version, most recent first", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Plan",
            payloadJson: {},
          }),
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

    const rejectionTab = screen.getByRole("button", { name: "Rejection Feedback" });
    await userEvent.click(rejectionTab);

    const headers = screen.getAllByText(/Plan V\d Rejection/);
    expect(headers[0].textContent).toBe("Plan V2 Rejection");
    expect(headers[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' if rejection artifacts vanish while that tab is active", () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "f", source: "api" },
          }),
        ]}
      />,
    );

    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: {} })]}
      />,
    );

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });
});
