import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

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
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("defaults to the first available tab and renders its Plan content", () => {
    const artifacts = [makeArtifact("Plan", { summary: "The plan summary" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByText("The plan summary")).toBeDefined();
  });

  it("only shows tabs for artifact types that are present", () => {
    const artifacts = [makeArtifact("Plan", { summary: "s" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("switches tabs and shows Review content for a Review artifact", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan summary" }),
      makeArtifact("Review", { overallVerdict: "approved", summary: "review summary" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("review summary")).toBeDefined();
  });

  it("renders PlanReview artifact type through ReviewView on the Plan Review tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("PlanReview", { overallVerdict: "changes_requested", summary: "needs work" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(screen.getByText("needs work")).toBeDefined();
  });

  it("renders ExecutionReport content on the Execution tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("ExecutionReport", { summary: "did the work", executionVersion: 2 }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("did the work")).toBeDefined();
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders plan revision dispositions on the Plan Revision tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Makes sense" },
          { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
          { findingId: "F3", status: "partially_incorporated", rationale: "Partial" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    // underscores replaced with spaces
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when PlanRevision has an empty dispositions array", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("PlanRevision", { dispositions: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions and falls back to executionVersion 2 when missing", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "Because" },
          { findingId: "R2", status: "rejected", action: "Won't fix", rationale: "Not valid" },
          { findingId: "R3", status: "other", action: "Deferred", rationale: "Later" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText(/v2 report\.$/)).toBeDefined();
  });

  it("uses the executionReport's executionVersion in the remediation footer when present", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText(/v5 report\.$/)).toBeDefined();
  });

  it("shows rejection feedback sorted with the latest plan version first", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan" }),
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { version: 1 },
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        { version: 2 },
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
  });

  it("shows 'No data available' when the active tab's artifact disappears after a prop update", () => {
    const { rerender } = render(
      <ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "plan" })]} />,
    );
    expect(screen.getByText("plan")).toBeDefined();

    // Replace the Plan artifact with a Review artifact; the "plan" tab state
    // persists (useState only initializes once) but the Plan artifact is gone.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Review", { summary: "review" })]} />);
    expect(screen.getByText("No data available")).toBeDefined();
  });
});
