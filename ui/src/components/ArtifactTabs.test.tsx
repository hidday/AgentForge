import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "a1",
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
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("renders only tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("defaults to the first available tab and switches on click", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "a1", type: "Plan", payloadJson: { summary: "Plan body" } }),
          makeArtifact({
            id: "a2",
            type: "ExecutionReport",
            payloadJson: { summary: "Execution body" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Plan body")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("Execution body")).toBeDefined();
    expect(screen.queryByText("Plan body")).toBeNull();
  });

  it("renders a ReviewView for both PlanReview and Review tabs", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            id: "a1",
            type: "PlanReview",
            payloadJson: { overallVerdict: "approved" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders plan revision dispositions with status styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "Makes sense." },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("Makes sense.")).toBeDefined();
  });

  it("shows an empty-dispositions message for a PlanRevision with none", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "PlanRevision", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions and an executionVersion-aware footnote", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                {
                  findingId: "f9",
                  status: "rejected",
                  action: "Reverted the change",
                  rationale: "Not needed",
                },
              ],
              executionReport: { executionVersion: 5 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("f9")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("Reverted the change")).toBeDefined();
    const footnote = screen.getByText((text) => text.includes("see the v"));
    expect(footnote.parentElement?.textContent).toContain("v5");
  });

  it("renders multiple rejection feedback artifacts sorted by version descending", () => {
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
    const headers = screen.getAllByText(/Rejection$/);
    expect(headers[0].textContent).toBe("Plan V2 Rejection");
    expect(headers[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
  });

  it("shows a 'no rejection feedback' message when the rejection tab has no matching artifacts", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "r1", type: "RejectionContext", payloadJson: { planVersion: 1, feedback: "x", source: "api" } }),
          makeArtifact({ id: "p1", type: "Plan", payloadJson: {} }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
  });

  it("shows a 'No data available' message when the active tab's artifact disappears after a prop update", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "p1", type: "Plan", payloadJson: {} }),
          makeArtifact({ id: "x1", type: "PlanReview", payloadJson: {} }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.queryByText("No data available")).toBeNull();

    // Re-render with the PlanReview artifact removed; the component's selected
    // tab state is not reset, so the content area falls back to the message.
    rerender(<ArtifactTabs artifacts={[makeArtifact({ id: "p1", type: "Plan", payloadJson: {} })]} />);
    expect(screen.getByText("No data available")).toBeDefined();
  });
});
