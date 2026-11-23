import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(type: string, payloadJson: unknown, version = 1, id = `${type}-${version}`): Artifact {
  return {
    id,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/No artifacts yet/i)).toBeDefined();
  });

  it("only shows tabs for artifact types that are present, defaulting to the first one active", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Code Review")).toBeDefined();
    expect(screen.queryByText("Execution")).toBeNull();
    expect(screen.queryByText("Remediation")).toBeNull();

    // Plan tab is active by default -> PlanView rendered
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches the rendered artifact view when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan summary" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByText("Code Review"));
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders ExecutionReportView for the ExecutionReport artifact type", () => {
    const artifacts = [makeArtifact("ExecutionReport", { summary: "exec" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Execution")).toBeDefined();
    expect(screen.getByTestId("execution-view")).toBeDefined();
  });

  it("renders the PlanRevision dispositions view, including an empty-state and populated entries", () => {
    const empty = [makeArtifact("PlanRevision", { dispositions: [] })];
    const { rerender } = render(<ArtifactTabs artifacts={empty} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();

    const populated = [
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Makes sense" },
          { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
          { findingId: "F3", status: "partially_incorporated", rationale: "Partially done" },
          { findingId: "F4", status: "pending", rationale: "Not yet reviewed" },
        ],
      }),
    ];
    rerender(<ArtifactTabs artifacts={populated} />);
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    // Unrecognized status ("pending") falls back to the default badge style.
    const pendingBadge = screen.getByText("pending");
    expect(pendingBadge.className).toContain("bg-surface-hover");
  });

  it("renders the Remediation resolutions view with resolution entries and the execution version note", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "F1", status: "accepted", action: "Fixed null check", rationale: "Needed" },
          { findingId: "F2", status: "rejected", action: "No change", rationale: "Not applicable" },
        ],
        executionReport: { executionVersion: 3 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed null check")).toBeDefined();
    expect(screen.getByText("No change")).toBeDefined();
    expect(screen.getByText(/the updated implementation/)).toBeDefined();
    expect(screen.getByText(/v.*3.*report\./)).toBeDefined();
  });

  it("defaults the remediation execution version note to v2 when no executionReport is present", () => {
    const artifacts = [makeArtifact("Remediation", { resolution: [] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/v.*2.*report\./)).toBeDefined();
  });

  it("renders rejection feedback tab content, sorted by version descending", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Please redo step 3", source: "api" },
        2,
        "rc-2",
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "Initial feedback", source: "linear" },
        1,
        "rc-1",
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByText("Rejection Feedback"));
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Please redo step 3")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();

    // Version 2 (most recent) should appear before version 1 in the DOM.
    const v2 = screen.getByText("Plan V2 Rejection");
    const v1 = screen.getByText("Plan V1 Rejection");
    expect(v2.compareDocumentPosition(v1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
