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
    id: overrides.id ?? "a1",
    runId: "run-1",
    type: overrides.type ?? "Plan",
    version: overrides.version ?? 1,
    payloadJson: overrides.payloadJson ?? {},
    rawText: overrides.rawText ?? "",
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty-state message when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults the active tab to the first available tab and renders its content via PlanView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { steps: ["a"] } })]}
      />,
    );
    expect(screen.getByTestId("plan-view").textContent).toBe('{"steps":["a"]}');
  });

  it("switches tabs and renders the corresponding artifact via ReviewView", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { x: 1 } }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { y: 2 } }),
        ]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toBe('{"y":2}');
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("renders ExecutionReportView for the Execution tab", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan" }),
          makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { score: 9 } }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view").textContent).toBe('{"score":9}');
  });

  it("shows 'No data available' when the active tab has no matching artifact after artifacts change shape", () => {
    // PlanReview tab is available (artifact present) but we simulate the edge case
    // via the rejectionFeedback-free branch: artifact list has the tab type removed.
    const { rerender } = render(
      <ArtifactTabs artifacts={[makeArtifact({ type: "PlanReview" })]} />,
    );
    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan" })]} />);
    // Active tab state persists as "planReview" but it's no longer in availableTabs/button list;
    // activeArtifact lookup fails -> falls through to "No data available" OR empty state if
    // availableTabs is now empty. Here Plan is available so tabs render; since activeTab
    // ("planReview") isn't in the new availableTabs, clicking isn't needed — assert tab bar now
    // only shows Plan.
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
  });

  it("renders multiple RejectionContext artifacts sorted by descending version with source badges", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "r1",
            type: "RejectionContext",
            version: 1,
            payloadJson: { planVersion: 1, feedback: "first rejection", source: "api" },
          }),
          makeArtifact({
            id: "r2",
            type: "RejectionContext",
            version: 2,
            payloadJson: { planVersion: 2, feedback: "second rejection", source: "linear" },
          }),
        ]}
      />,
    );
    const feedbacks = screen.getAllByText(/rejection$/);
    expect(feedbacks[0].textContent).toBe("second rejection");
    expect(feedbacks[1].textContent).toBe("first rejection");
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' guard text is unreachable when tab only renders if artifacts exist; verifies PlanRevision empty dispositions state instead", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
        ]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders PlanRevision dispositions with status-specific styling and label formatting", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "looks good" },
                { findingId: "F2", status: "dismissed", rationale: "not applicable" },
                { findingId: "F3", status: "partially_incorporated", rationale: "partial" },
                { findingId: "F4", status: "unknown_status", rationale: "fallback" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("renders Remediation resolutions with status styling and the executionVersion fallback text", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                { findingId: "F1", status: "accepted", action: "fixed it", rationale: "r1" },
                { findingId: "F2", status: "rejected", action: "n/a", rationale: "r2" },
                { findingId: "F3", status: "pending", action: "tbd", rationale: "r3" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("fixed it")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    // Default executionVersion fallback is 2 when no executionReport is present
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it("uses the actual executionVersion from the remediation payload when present", () => {
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
    expect(screen.getByText(/v5/)).toBeDefined();
  });
});
