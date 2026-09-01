import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";
import { ArtifactTabs } from "./ArtifactTabs.tsx";

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

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: `${type}-${overrides.version ?? 1}`,
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
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", { steps: [] })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", { steps: [{ id: "s1" }] })]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches tabs and content on click", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { steps: [] }),
          makeArtifact("Review", { overallVerdict: "approved" }),
        ]}
      />,
    );

    expect(screen.getByTestId("plan-view")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.queryByTestId("plan-view")).toBeNull();
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders the PlanReview tab through ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("PlanReview", { overallVerdict: "changes_requested" })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByTestId("review-view").textContent).toContain("changes_requested");
  });

  it("renders the Execution tab through ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { summary: "Done work" })]}
      />,
    );
    expect(screen.getByTestId("execution-view").textContent).toContain("Done work");
  });

  it("renders PlanRevision dispositions with status styling and formatted status text", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Looks good" },
              { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
              { findingId: "F3", status: "partially_incorporated", rationale: "Partly done" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("Looks good")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
  });

  it("shows a message when PlanRevision has no dispositions", () => {
    render(
      <ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions with rationale and default executionVersion fallback", () => {
    const { container } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              {
                findingId: "R1",
                status: "accepted",
                action: "Fixed the bug",
                rationale: "Root cause addressed",
              },
              {
                findingId: "R2",
                status: "rejected",
                action: "Declined change",
                rationale: "Out of scope",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("R1")).toBeDefined();
    expect(screen.getByText("Fixed the bug")).toBeDefined();
    expect(screen.getByText("Root cause addressed")).toBeDefined();
    // executionVersion falls back to 2 when not present on the remediation payload
    const note = container.querySelector("p.italic");
    expect(note?.textContent?.replace(/\s+/g, " ")).toContain("v2 report.");
  });

  it("renders the RejectionFeedback tab with multiple artifacts sorted by version descending", () => {
    render(
      <ArtifactTabs
        artifacts={[
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
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();

    // Version 2 (the latest rejection) must appear before version 1 in the DOM.
    const v2Heading = screen.getByText("Plan V2 Rejection");
    const v1Heading = screen.getByText("Plan V1 Rejection");
    expect(
      v2Heading.compareDocumentPosition(v1Heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
