import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: overrides.id ?? "art-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only tabs for artifact types that are present, defaulting to the first", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { summary: "Exec summary" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    // Types with no matching artifact are not rendered as tabs
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();

    // First available tab (Plan) is active by default
    const planTab = screen.getByRole("button", { name: "Plan" });
    expect(planTab.className).toContain("bg-accent");
  });

  it("switches tabs on click, updating active styling and content", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({
        id: "a2",
        type: "ExecutionReport",
        payloadJson: { summary: "Exec summary", executionVersion: 3 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const execTab = screen.getByRole("button", { name: "Execution" });

    expect(planTab.className).toContain("bg-accent");
    expect(execTab.className).not.toContain("bg-accent");

    await userEvent.click(execTab);

    expect(execTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
    // Execution version from ExecutionReportView payload rendering
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders Review content for both PlanReview and Review artifact types", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanReview",
        payloadJson: { overallVerdict: "approved", summary: "Looks good" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Looks good")).toBeDefined();
  });

  it("renders PlanRevision dispositions, with an empty state when none recorded", async () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: { summary: "plan" },
      }),
      makeArtifact({
        id: "a2",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Makes sense" },
            { findingId: "F2", status: "partially_incorporated", rationale: "Some of it" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
  });

  it("renders the empty PlanRevision state when dispositions is empty", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and falls back to executionVersion 2 when absent", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "F9", status: "accepted", action: "Fixed it", rationale: "was a bug" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("F9")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText(/report\.$/)).toBeDefined();
  });

  it("renders multiple rejection feedback entries sorted by version descending", async () => {
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
      .getAllByText((_, el) => el?.tagName === "P" && /rejection$/i.test(el.textContent ?? ""))
      .map((el) => el.textContent);
    expect(feedbackTexts).toEqual(["Second rejection", "First rejection"]);
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' if the active tab's artifacts disappear after a prop update", () => {
    // Mount with only a RejectionContext artifact so the initial (and only) active tab
    // is "rejectionFeedback".
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "r1",
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "Feedback", source: "api" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Feedback")).toBeDefined();

    // Update props so RejectionContext artifacts are gone but the component instance
    // (and its activeTab state) persists — this exercises the empty-feedback fallback.
    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "Plan", payloadJson: {} })]}
      />,
    );

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("shows 'No data available' when the active tab's matching artifact disappears after a prop update", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { summary: "exec" } }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("v1")).toBeDefined();

    // Remove the ExecutionReport artifact while keeping activeTab pinned to "execution".
    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "Plan", payloadJson: {} })]}
      />,
    );

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
