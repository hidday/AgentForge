import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mock the heavy child view components so we exercise ArtifactTabs' own
// tab-switching / artifact-selection logic, not their internals.
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

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: overrides.id ?? `${type}-${Math.random()}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
    // No tab bar should render
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only tabs for artifact types present, defaulting to the first available tab", () => {
    const artifacts = [
      makeArtifact("Plan", { steps: ["a"] }),
      makeArtifact("ExecutionReport", { status: "ok" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Only Plan and Execution tabs should show, not Plan Review / Code Review etc.
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();

    // Defaults to first available tab's content (Plan)
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches tab content when clicking another available tab", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("Plan", { steps: ["a"] }),
      makeArtifact("ExecutionReport", { status: "ok" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Execution" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("execution-view")).toBeDefined();
  });

  it("applies active styling to the selected tab button", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("Plan", {}),
      makeArtifact("ExecutionReport", {}),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planBtn = screen.getByRole("button", { name: "Plan" });
    const execBtn = screen.getByRole("button", { name: "Execution" });

    expect(planBtn.className).toContain("bg-accent");
    expect(execBtn.className).not.toContain("bg-accent");

    await user.click(execBtn);

    expect(execBtn.className).toContain("bg-accent");
    expect(planBtn.className).not.toContain("bg-accent");
  });

  it("routes both planReview and review tabs through ReviewView", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("PlanReview", { verdict: "approve" }),
      makeArtifact("Review", { verdict: "changes_requested" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    // Default tab is the first available: planReview
    expect(screen.getByTestId("review-view").textContent).toContain("approve");

    await user.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view").textContent).toContain(
      "changes_requested",
    );
  });

  it("shows 'No data available' when the active tab's artifact disappears from a subsequent artifacts update", async () => {
    const user = userEvent.setup();
    const initial = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("ExecutionReport", { status: "ok" }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={initial} />);

    await user.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view")).toBeDefined();

    // Re-render with the ExecutionReport artifact removed while the
    // component instance (and its activeTab state) is preserved.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { steps: [] })]} />);

    expect(screen.queryByTestId("execution-view")).toBeNull();
    expect(screen.getByText(/No data available/i)).toBeDefined();
    // The Execution tab button itself is gone since it's no longer available
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("shows 'No rejection feedback recorded' when the rejection artifacts disappear from a subsequent update", async () => {
    const user = userEvent.setup();
    const initial = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("RejectionContext", {
        planVersion: 1,
        feedback: "Needs work",
        source: "api",
      }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={initial} />);

    await user.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Needs work")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { steps: [] })]} />);

    expect(screen.queryByText("Needs work")).toBeNull();
    expect(screen.getByText(/No rejection feedback recorded/i)).toBeDefined();
  });

  it("renders PlanRevision dispositions view via the planRevision tab", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F-1", status: "accepted", rationale: "Looks good" },
          { findingId: "F-2", status: "dismissed", rationale: "Not applicable" },
          {
            findingId: "F-3",
            status: "partially_incorporated",
            rationale: "Partly done",
          },
          { findingId: "F-4", status: "unknown_status", rationale: "Other" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await user.click(screen.getByRole("button", { name: "Plan Revision" }));

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F-1")).toBeDefined();
    // underscore replaced with space in status label
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("Looks good")).toBeDefined();
  });

  it("renders 'No dispositions recorded' when PlanRevision has an empty dispositions array", async () => {
    const artifacts = [
      makeArtifact("PlanRevision", { dispositions: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/No dispositions recorded/i)).toBeDefined();
  });

  it("renders 'No dispositions recorded' when PlanRevision payload omits dispositions entirely", async () => {
    const artifacts = [makeArtifact("PlanRevision", {})];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/No dispositions recorded/i)).toBeDefined();
  });

  it("renders Remediation resolutions with accepted/rejected/other status styling and executionVersion fallback", async () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          {
            findingId: "R-1",
            status: "accepted",
            action: "Fixed it",
            rationale: "Because tests passed",
          },
          {
            findingId: "R-2",
            status: "rejected",
            action: "Won't fix",
            rationale: "Out of scope",
          },
          {
            findingId: "R-3",
            status: "pending",
            action: "In progress",
            rationale: "Needs more time",
          },
        ],
        // no executionReport -> fallback version "2"
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("Won't fix")).toBeDefined();
    expect(screen.getByText("In progress")).toBeDefined();
    // fallback executionVersion of 2 when remediation.executionReport is absent
    const note = screen.getByText(/Post-remediation lint\/typecheck\/test status/i);
    expect(note.textContent).toContain("v");
    expect(note.textContent).toContain("2");
    expect(note.textContent).toContain("report.");
  });

  it("renders Remediation with an empty resolutions list when the resolution field is omitted", () => {
    const artifacts = [makeArtifact("Remediation", {})];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    // Fallback to [] means no per-finding rows are rendered
    expect(screen.queryByText(/^R-/)).toBeNull();
  });

  it("uses the explicit executionVersion from remediation.executionReport when present", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    const note = screen.getByText(/Post-remediation lint\/typecheck\/test status/i);
    expect(note.textContent).toContain("5");
    expect(note.textContent).not.toContain("v2 ");
  });

  it("renders rejection feedback sorted descending by version, with source badge", () => {
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

    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();

    // Descending order: version 2 ("Second rejection") should appear before version 1
    const container = screen.getByText("Second rejection").closest("div.space-y-3");
    expect(container).not.toBeNull();
    const headings = container
      ? Array.from(container.querySelectorAll("span.text-xs.font-medium")).map(
          (el) => el.textContent,
        )
      : [];
    expect(headings).toEqual(["Plan V2 Rejection", "Plan V1 Rejection"]);
  });

  it("passes the artifact's payloadJson through to PlanView for the plan tab", () => {
    const artifacts = [makeArtifact("Plan", { steps: ["only-step"] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view").textContent).toContain("only-step");
  });
});
