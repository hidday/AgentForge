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
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./),
    ).toBeDefined();
  });

  it("renders only the tabs for artifact types that are present, defaulting to the first one", () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan Revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Defaults to the first available tab's content
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders the execution report via ExecutionReportView for the Execution tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("ExecutionReport", { summary: "done" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view").textContent).toContain("done");
  });

  it("renders dispositions for the Plan Revision tab, sorted content included", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Looks right" },
          { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Looks right")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when the Plan Revision artifact has none", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanRevision", { dispositions: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions for the Remediation tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "F1", status: "accepted", action: "Fixed null check", rationale: "Confirmed bug" },
        ],
        executionReport: { executionVersion: 3 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed null check")).toBeDefined();
    expect(screen.getByText(/v\s*3\s*report\.?/)).toBeDefined();
  });

  it("shows rejection feedback sorted by version descending, with multiple entries", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { id: "rc1", version: 1 },
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        { id: "rc2", version: 2 },
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen.getAllByText(/rejection/);
    // "Second rejection" (higher version) should come first in the DOM
    expect(feedbackTexts[0].textContent).toBe("Second rejection");
    expect(feedbackTexts[1].textContent).toBe("First rejection");
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
  });
});
