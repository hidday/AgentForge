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

function makeArtifact(type: string, payload: unknown, version = 1, id = type): Artifact {
  return {
    id,
    runId: "r1",
    type,
    version,
    payloadJson: payload,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/hasn't produced any output/)).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { steps: [] })]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults to the first available tab and renders it via PlanView", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "x" })]} />);
    expect(screen.getByTestId("plan-view")).toBeDefined();
  });

  it("switches tabs on click and renders the corresponding view", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "plan" }),
          makeArtifact("Review", { summary: "review" }),
        ]}
      />,
    );
    expect(screen.getByTestId("plan-view")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });

  it("routes a PlanReview artifact through ReviewView as well", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", {}),
          makeArtifact("PlanReview", { overallVerdict: "approved" }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();
  });

  it("renders an ExecutionReport artifact via ExecutionReportView", async () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", {}), makeArtifact("ExecutionReport", { score: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByTestId("execution-view")).toBeDefined();
  });

  it("renders PlanRevision dispositions with their status badges", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", {}),
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "f1", status: "accepted", rationale: "fixed it" },
            ],
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("fixed it")).toBeDefined();
  });

  it("applies the dismissed, partially_incorporated, and fallback status styles for dispositions", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", {}),
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "f1", status: "dismissed", rationale: "not applicable" },
              { findingId: "f2", status: "partially_incorporated", rationale: "half done" },
              { findingId: "f3", status: "unknown_status", rationale: "n/a" },
            ],
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("dismissed").className).toContain("state-blocked");
    expect(screen.getByText("partially incorporated").className).toContain("state-waiting");
    expect(screen.getByText("unknown status").className).toContain("surface-hover");
  });

  it("shows an empty-dispositions message for a PlanRevision artifact with none", async () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", {}), makeArtifact("PlanRevision", {})]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and references the next execution version", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", {}),
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "f2", status: "rejected", action: "wontfix", rationale: "n/a" },
            ],
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText("f2")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText(/v2 report/)).toBeDefined();
  });

  it("groups multiple RejectionContext artifacts, latest version first", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", {}),
          makeArtifact(
            "RejectionContext",
            { planVersion: 1, feedback: "first rejection", source: "api" },
            1,
            "rej-1",
          ),
          makeArtifact(
            "RejectionContext",
            { planVersion: 2, feedback: "second rejection", source: "linear" },
            2,
            "rej-2",
          ),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
  });

  it("shows 'No data available' when the selected tab's artifact disappears from a later artifacts update", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", {}), makeArtifact("Review", { summary: "r" })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByTestId("review-view")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", {})]} />);
    expect(screen.getByText("No data available")).toBeDefined();
  });
});
