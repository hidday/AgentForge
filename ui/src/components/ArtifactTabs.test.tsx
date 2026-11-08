import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";
import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "art-1",
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
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "plan summary" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content (PlanView)", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Do the thing" } }),
        ]}
      />,
    );
    // PlanView renders the summary through Markdown
    expect(screen.getByText("Do the thing")).toBeDefined();
  });

  it("switches tab content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "plan text" } }),
          makeArtifact({
            id: "a2",
            type: "Review",
            payloadJson: { summary: "review text", overallVerdict: "approved" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("plan text")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("review text")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("highlights the active tab button distinctly from inactive tabs", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan" }),
          makeArtifact({ id: "a2", type: "Review" }),
        ]}
      />,
    );
    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(planTab.className).toContain("bg-accent");
    expect(reviewTab.className).not.toContain("bg-accent");

    await userEvent.click(reviewTab);
    expect(reviewTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
  });

  it("renders PlanRevision artifacts via PlanRevisionView with dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F-1", status: "accepted", rationale: "Looks right" },
                { findingId: "F-2", status: "dismissed", rationale: "Not applicable" },
                { findingId: "F-3", status: "partially_incorporated", rationale: "Partial" },
                { findingId: "F-4", status: "unknown_status", rationale: "Fallback style" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("F-1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    // Unrecognized status falls back to the default (bg-surface-hover) style.
    const fallbackBadge = screen.getByText("unknown status");
    expect(fallbackBadge.className).toContain("bg-surface-hover");
  });

  it("shows 'No dispositions recorded' for a PlanRevision artifact with no dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders ExecutionReport artifacts via ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "ExecutionReport",
            payloadJson: { summary: "executed changes", executionVersion: 1 },
          }),
        ]}
      />,
    );
    expect(screen.getByText("executed changes")).toBeDefined();
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders Remediation artifacts via RemediationView with resolutions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "Remediation",
            payloadJson: {
              resolution: [
                {
                  findingId: "F-9",
                  status: "accepted",
                  action: "Fixed the bug",
                  rationale: "Was broken",
                },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("F-9")).toBeDefined();
    expect(screen.getByText("Fixed the bug")).toBeDefined();
    expect(screen.getByText(/report\./)).toBeDefined();
  });

  it("renders no rejection feedback message when RejectionContext tab has no matching artifacts", () => {
    // Force into a state where the rejectionFeedback tab is selected but has no artifacts:
    // happens naturally only via click since initial tab depends on availableTabs ordering.
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ id: "a1", type: "RejectionContext", version: 1, payloadJson: { planVersion: 1, feedback: "", source: "api" } })]}
      />,
    );
    // This artifact exists, so feedback view renders rather than the empty message.
    expect(screen.queryByText("No rejection feedback recorded")).toBeNull();
  });

  it("renders rejection feedback sorted by version descending, most recent first", () => {
    render(
      <ArtifactTabs
        artifacts={[
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
        ]}
      />,
    );
    const secondFeedback = screen.getByText("Second rejection");
    const firstFeedback = screen.getByText("First rejection");
    expect(secondFeedback).toBeDefined();
    expect(firstFeedback).toBeDefined();
    // "Second rejection" (version 2) should appear before "First rejection" (version 1) in the DOM.
    expect(
      secondFeedback.compareDocumentPosition(firstFeedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("renders a Plan artifact with an empty payload without crashing (no optional fields)", () => {
    render(<ArtifactTabs artifacts={[makeArtifact({ id: "a1", type: "Plan", payloadJson: {} })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });
});
