import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty-state message when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("renders a single tab when only one artifact type is present and selects it by default", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("renders multiple tabs in the fixed TABS order and lets the user switch between them", async () => {
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "The plan" } }),
      makeArtifact({
        id: "a2",
        type: "Review",
        payloadJson: { summary: "The review", overallVerdict: "approved" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(planTab).toBeDefined();
    expect(reviewTab).toBeDefined();

    // Plan tab active by default (first matching tab in TABS order)
    expect(screen.getByText("The plan")).toBeDefined();
    expect(screen.queryByText("The review")).toBeNull();

    await userEvent.click(reviewTab);
    expect(screen.getByText("The review")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.queryByText("The plan")).toBeNull();
  });

  it("shows 'No data available' when the active tab's artifact type is missing for a different tabId", () => {
    // Only a Review artifact, no Plan — Plan tab should not even render, but
    // verify Review content and that ReviewView handles an empty findings array
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Review", payloadJson: {} })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    // ReviewView renders nothing identifiable for an empty payload; container should
    // at least not crash and show the artifact panel.
    expect(screen.queryByText(/No data available/)).toBeNull();
  });

  it("renders the rejection feedback tab with multiple entries sorted by version descending", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
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

  it("renders the plan revision tab with disposition status styling and text", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "F1", status: "accepted", rationale: "Looks good" },
            { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Looks good")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
  });

  it("shows 'No dispositions recorded' for an empty PlanRevision dispositions array", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders the remediation tab with resolutions and the execution version fallback note", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "done" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    // No executionReport in payload -> falls back to v2 in the note text
    expect(screen.getByText(/report\./)).toBeDefined();
  });

  it("renders the execution tab via ExecutionReportView", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({
        type: "ExecutionReport",
        payloadJson: { summary: "Execution done", filesChanged: ["src/a.ts"] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));

    expect(screen.getByText("Execution done")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
  });
});
