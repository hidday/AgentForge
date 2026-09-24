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

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: overrides.id ?? `${type}-1`,
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
  });

  it("renders only tabs for artifact types present, and defaults to the first available tab", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "s" }),
      makeArtifact("Review", { overallVerdict: "approve" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Code Review")).toBeDefined();
    // Tabs not backed by an artifact should not render
    expect(screen.queryByText("Plan Review")).toBeNull();
    expect(screen.queryByText("Execution")).toBeNull();

    // Defaults to Plan tab content
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("passes the artifact's payloadJson through to PlanView on the Plan tab", () => {
    const artifacts = [makeArtifact("Plan", { summary: "hello plan" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByTestId("plan-view").textContent).toContain("hello plan");
  });

  it("switches tab content when clicking a different tab (PlanReview -> ReviewView)", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "plan payload" }),
      makeArtifact("PlanReview", { overallVerdict: "changes_requested" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByText("Plan Review"));

    expect(screen.queryByTestId("plan-view")).toBeNull();
    const reviewEl = screen.getByTestId("review-view");
    expect(reviewEl.textContent).toContain("changes_requested");
  });

  it("renders ExecutionReportView on the Execution tab", async () => {
    const artifacts = [
      makeArtifact("Plan", {}),
      makeArtifact("ExecutionReport", { summary: "did the work" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByText("Execution"));
    expect(screen.getByTestId("execution-view").textContent).toContain("did the work");
  });

  describe("Plan Revision tab", () => {
    it("shows 'No dispositions recorded' when dispositions array is empty", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact("PlanRevision", { dispositions: [] }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Plan Revision"));
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("shows 'No dispositions recorded' when dispositions field is missing entirely", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact("PlanRevision", {}),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Plan Revision"));
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders each disposition with its finding id, status badge, and rationale", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact("PlanRevision", {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Fixed it" },
            { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
            {
              findingId: "F3",
              status: "partially_incorporated",
              rationale: "Partly addressed",
            },
            { findingId: "F4", status: "unknown_status", rationale: "Other" },
          ],
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Plan Revision"));

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // underscores replaced with spaces
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling and the execution version footnote", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact("Remediation", {
          resolution: [
            {
              findingId: "R1",
              status: "accepted",
              action: "Patched",
              rationale: "Root cause fixed",
            },
            {
              findingId: "R2",
              status: "rejected",
              action: "Won't fix",
              rationale: "Out of scope",
            },
            {
              findingId: "R3",
              status: "deferred",
              action: "Later",
              rationale: "Needs follow-up",
            },
          ],
          executionReport: { executionVersion: 3 },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Remediation"));

      expect(screen.getByText("R1")).toBeDefined();
      expect(screen.getByText("Patched")).toBeDefined();
      expect(screen.getByText("Root cause fixed")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      expect(screen.getByText(/open it to see the v3 report/)).toBeDefined();
    });

    it("defaults the execution version footnote to v2 when executionReport is missing", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact("Remediation", { resolution: [] }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Remediation"));
      expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();
    });
  });

  describe("Rejection Feedback tab", () => {
    it("shows all rejection artifacts sorted descending by version, with source badges", async () => {
      const artifacts = [
        makeArtifact("Plan", {}),
        makeArtifact(
          "RejectionContext",
          { planVersion: 1, feedback: "First rejection reason", source: "api" },
          { id: "rc1", version: 1 },
        ),
        makeArtifact(
          "RejectionContext",
          { planVersion: 2, feedback: "Second rejection reason", source: "linear" },
          { id: "rc2", version: 2 },
        ),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      await userEvent.click(screen.getByText("Rejection Feedback"));

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings).toHaveLength(2);
      // Sorted descending: V2 (artifact version 2) should come first in the DOM
      expect(headings[0].textContent).toContain("V2");
      expect(headings[1].textContent).toContain("V1");

      expect(screen.getByText("First rejection reason")).toBeDefined();
      expect(screen.getByText("Second rejection reason")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });
  });
});
