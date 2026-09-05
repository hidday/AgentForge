import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";
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
  it("shows empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/hasn't produced any output/i)).toBeDefined();
  });

  it("renders only tabs for artifact types present, defaulting to the first tab", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { summary: "Ran it" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();

    // Plan tab active by default (it's first in TABS order that's available)
    expect(screen.getByText("The plan")).toBeDefined();
  });

  it("switches active tab content when a tab button is clicked", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { summary: "Ran it" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("Ran it")).toBeDefined();
    expect(screen.queryByText("The plan")).toBeNull();
  });

  it("renders PlanReview and Review artifact types through ReviewView", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanReview",
        payloadJson: { summary: "Review summary", findings: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Review summary")).toBeDefined();
  });

  it("renders PlanRevision artifact with dispositions", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Makes sense" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
  });

  it("renders PlanRevision empty state when there are no dispositions", () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("applies disposition status style variants (dismissed, partially_incorporated, unknown)", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "dismissed", rationale: "r1" },
            { findingId: "F2", status: "partially_incorporated", rationale: "r2" },
            { findingId: "F3", status: "weird_status", rationale: "r3" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird status")).toBeDefined();
  });

  it("renders Remediation artifact with resolutions and executionVersion fallback", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "why" },
            { findingId: "F2", status: "rejected", action: "Skipped", rationale: "why not" },
            { findingId: "F3", status: "other", action: "Deferred", rationale: "later" },
          ],
        },
      }),
    ];
    const { container } = render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("Skipped")).toBeDefined();
    expect(screen.getByText("Deferred")).toBeDefined();
    // fallback executionVersion of 2 when remediation.executionReport is absent
    expect(container.textContent).toContain("v2 report.");
  });

  it("renders Remediation executionVersion from executionReport when present", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Remediation",
        payloadJson: {
          resolution: [],
          executionReport: { executionVersion: 5 },
        },
      }),
    ];
    const { container } = render(<ArtifactTabs artifacts={artifacts} />);
    expect(container.textContent).toContain("v5 report.");
  });

  it("renders rejection feedback tab with multiple artifacts sorted by version descending", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
      }),
      makeArtifact({
        id: "a2",
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
    const feedbacks = screen.getAllByText(/rejection$/);
    expect(feedbacks[0].textContent).toBe("Second rejection");
    expect(feedbacks[1].textContent).toBe("First rejection");
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("shows 'No data available' when the active tab's artifact disappears on re-render", async () => {
    const withBoth = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({ id: "a2", type: "ExecutionReport", payloadJson: { summary: "Ran it" } }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={withBoth} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("Ran it")).toBeDefined();

    // Remove the ExecutionReport artifact while the component stays mounted —
    // activeTab state still points at "execution" but no artifact matches it.
    const onlyPlan = [withBoth[0]];
    rerender(<ArtifactTabs artifacts={onlyPlan} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
