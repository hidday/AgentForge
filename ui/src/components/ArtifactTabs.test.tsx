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

function makeArtifact(type: string, payloadJson: unknown, version = 1, id?: string): Artifact {
  return {
    id: id ?? `${type}-${version}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./i),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });

  it("renders only tabs for artifact types that are present, and selects the first tab by default", () => {
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    // Not present since no matching artifact
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();

    // Plan tab active by default -> PlanView rendered
    expect(screen.getByTestId("plan-view")).toBeDefined();
    expect(screen.queryByTestId("review-view")).toBeNull();
  });

  it("clicking a tab switches the active tab and renders that artifact's content", async () => {
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByTestId("review-view")).toBeDefined();
    expect(screen.queryByTestId("plan-view")).toBeNull();

    // Active tab button should carry the active styling class
    const reviewTabBtn = screen.getByRole("button", { name: "Code Review" });
    expect(reviewTabBtn.className).toContain("bg-accent");
    const planTabBtn = screen.getByRole("button", { name: "Plan" });
    expect(planTabBtn.className).not.toContain("bg-accent");
  });

  it("renders the ExecutionReportView for the ExecutionReport artifact type", () => {
    const artifacts = [makeArtifact("ExecutionReport", { summary: "done" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("execution-view")).toBeDefined();
  });

  it("shows rejection feedback entries sorted by version descending, using the RejectionFeedback tab", async () => {
    const artifacts = [
      makeArtifact("Plan", { steps: [] }),
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        1,
        "rej-1",
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        2,
        "rej-2",
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

    const feedbackTexts = screen
      .getAllByText(/rejection$/i, { selector: "p" })
      .map((el) => el.textContent);
    expect(feedbackTexts).toEqual(["Second rejection", "First rejection"]);
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("shows a 'no dispositions' fallback message for a PlanRevision artifact with an empty dispositions list", () => {
    const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders plan-revision dispositions with status-specific styling", () => {
    const artifacts = [
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Looks good" },
          { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
          { findingId: "F3", status: "partially_incorporated", rationale: "Partial" },
          { findingId: "F4", status: "unknown_status", rationale: "Other" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("renders remediation resolutions and falls back to executionVersion 2 when absent", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "R1", status: "accepted", action: "Fixed it", rationale: "why" },
          { findingId: "R2", status: "rejected", action: "Skipped", rationale: "why not" },
          { findingId: "R3", status: "other", action: "Deferred", rationale: "later" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText(/open it to see the v2 report\./i)).toBeDefined();
  });

  it("uses the executionVersion from the remediation payload when present", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/open it to see the v5 report\./i)).toBeDefined();
  });
});
