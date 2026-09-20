import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

vi.mock("./PlanView.tsx", () => ({
  PlanView: ({ plan }: { plan: Record<string, unknown> }) => (
    <div data-testid="plan-view">{String(plan.summary)}</div>
  ),
}));

vi.mock("./ReviewView.tsx", () => ({
  ReviewView: ({ review }: { review: Record<string, unknown> }) => (
    <div data-testid="review-view">{String(review.overallVerdict)}</div>
  ),
}));

vi.mock("./ExecutionReportView.tsx", () => ({
  ExecutionReportView: ({ report }: { report: Record<string, unknown> }) => (
    <div data-testid="execution-view">{String(report.summary)}</div>
  ),
}));

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-06-08T16:26:58.000Z",
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

  it("only renders tabs for artifact types that are present, defaulting to the first one", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { overallVerdict: "approve" } }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Defaults to the first available tab (Plan)
    expect(screen.getByTestId("plan-view").textContent).toBe("Plan summary");
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("switches content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({ id: "a2", type: "Review", payloadJson: { overallVerdict: "approve" } }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByTestId("review-view").textContent).toBe("approve");
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("renders the ExecutionReport artifact under the Execution tab", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({
        id: "a2",
        type: "ExecutionReport",
        payloadJson: { summary: "Execution summary" },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));

    expect(screen.getByTestId("execution-view").textContent).toBe("Execution summary");
  });

  it("renders PlanRevision dispositions when present", async () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Makes sense." },
            { findingId: "F2", status: "dismissed", rationale: "Out of scope." },
          ],
        },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Makes sense.")).toBeDefined();
    expect(screen.getByText("F2")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
  });

  it("shows a fallback message when a PlanRevision has no dispositions", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and the execution version fallback note", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            {
              findingId: "F1",
              status: "accepted",
              action: "Fixed the null check.",
              rationale: "Was causing a crash.",
            },
            {
              findingId: "F2",
              status: "rejected",
              action: "Left as-is.",
              rationale: "False positive.",
            },
          ],
        },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed the null check.")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Left as-is.")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    // No executionReport field on the payload -> falls back to v2.
    expect(screen.getByText(/report\./)).toBeDefined();
  });

  it("sorts multiple rejection-feedback artifacts by version, newest first", () => {
    const artifacts = [
      makeArtifact({
        id: "r1",
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "First rejection reason.", source: "api" },
      }),
      makeArtifact({
        id: "r2",
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Second rejection reason.", source: "linear" },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    // Only a RejectionContext artifact is present, so its tab is selected by default.
    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();

    const headings = screen.getAllByText(/Plan V\d Rejection/).map((el) => el.textContent);
    expect(headings).toEqual(["Plan V2 Rejection", "Plan V1 Rejection"]);
    expect(screen.getByText("Second rejection reason.")).toBeDefined();
    expect(screen.getByText("First rejection reason.")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("renders rejection feedback after switching away from the default tab", async () => {
    // Include both a Plan artifact (default tab) and a RejectionContext tab.
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan summary" } }),
      makeArtifact({
        id: "a2",
        type: "RejectionContext",
        payloadJson: { planVersion: 1, feedback: "Needs work.", source: "api" },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    expect(screen.getByText("Needs work.")).toBeDefined();
  });
});
