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
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
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
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "s" })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults to the first available tab and renders its view", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Review", { overallVerdict: "approved" }),
          makeArtifact("ExecutionReport", { summary: "exec" }),
        ]}
      />,
    );
    // Execution tab appears before review in TABS order, so it's default... actually
    // Execution comes before Review in TABS array, so execution should be first.
    expect(screen.getByTestId("execution-view")).toBeDefined();
  });

  it("switches the active tab and its content when a tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "plan summary" }),
          makeArtifact("Review", { overallVerdict: "approved" }),
        ]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("passes the plan payload through to PlanView", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "hi" })]} />);
    expect(screen.getByTestId("plan-view").textContent).toContain("hi");
  });

  it("renders PlanReview artifacts through ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("PlanReview", { overallVerdict: "approved" })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders rejection feedback details for the active RejectionContext tab", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("RejectionContext", {
            planVersion: 1,
            feedback: "needs more detail",
            source: "api",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("needs more detail")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("sorts multiple rejection feedback artifacts by version descending", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact(
            "RejectionContext",
            { planVersion: 1, feedback: "first rejection", source: "linear" },
            { id: "rc1", version: 1 },
          ),
          makeArtifact(
            "RejectionContext",
            { planVersion: 2, feedback: "second rejection", source: "api" },
            { id: "rc2", version: 2 },
          ),
        ]}
      />,
    );
    const headers = screen.getAllByText(/Rejection$/);
    expect(headers[0].textContent).toBe("Plan V2 Rejection");
    expect(headers[1].textContent).toBe("Plan V1 Rejection");
  });

  it("renders PlanRevision dispositions with status-specific styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Looks good" },
              { findingId: "F2", status: "dismissed", rationale: "Not relevant" },
              { findingId: "F3", status: "partially_incorporated", rationale: "Partial" },
              { findingId: "F4", status: "weird_status", rationale: "fallback" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("weird status")).toBeDefined();
  });

  it("renders 'No dispositions recorded' when PlanRevision has an empty dispositions list", () => {
    render(
      <ArtifactTabs artifacts={[makeArtifact("PlanRevision", { dispositions: [] })]} />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions with status-specific styling and the fallback version footnote", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "r1" },
              { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "r2" },
              { findingId: "F3", status: "other", action: "Deferred", rationale: "r3" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText("Won't fix")).toBeDefined();
    expect(screen.getByText("Deferred")).toBeDefined();
    // No executionReport in payload -> falls back to v2 in the footnote
    expect(screen.getByText(/v2.*report\.$/)).toBeDefined();
  });

  it("uses the remediation's executionReport.executionVersion in the footnote when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [],
            executionReport: { executionVersion: 5 },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/v5.*report\.$/)).toBeDefined();
  });

  it("renders a resolution's status badge text verbatim (e.g. 'rejected')", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "F9", status: "rejected", action: "No action", rationale: "r" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("rejected")).toBeDefined();
  });
});
