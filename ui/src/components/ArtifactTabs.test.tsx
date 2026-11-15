import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: overrides.id ?? "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/no artifacts yet/i),
    ).toBeDefined();
  });

  it("only shows tabs for artifact types that are present, defaulting to the first available tab", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { planVersion: 3 } }),
          makeArtifact({ id: "a2", type: "Review", payloadJson: { summary: "lgtm" } }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Plan Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remediation" })).toBeNull();

    // Defaults to the first available tab's content (Plan -> PlanView renders "v3")
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("switches content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan", payloadJson: { planVersion: 1 } }),
          makeArtifact({
            id: "a2",
            type: "Review",
            payloadJson: { summary: "Looks solid" },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("Looks solid")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByText("Looks solid")).toBeDefined();
  });

  it("highlights the active tab with the accent style and others without it", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "Plan" }),
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

  it("picks the first matching artifact when duplicates of the same type exist", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ id: "first", type: "Plan", payloadJson: { planVersion: 1 } }),
          makeArtifact({ id: "second", type: "Plan", payloadJson: { planVersion: 2 } }),
        ]}
      />,
    );

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText("v2")).toBeNull();
  });

  it("renders the Execution tab content via ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: { executionVersion: 4, summary: "All checks passed" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("v4")).toBeDefined();
    expect(screen.getByText("All checks passed")).toBeDefined();
  });

  it("renders PlanRevision dispositions with status-specific styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F1", status: "accepted", rationale: "Makes sense" },
                {
                  findingId: "F2",
                  status: "partially_incorporated",
                  rationale: "Did half of it",
                },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
    // Underscore in status is rendered as a space for display
    expect(screen.getByText("partially incorporated")).toBeDefined();
  });

  it("styles a 'dismissed' disposition and falls back to the muted style for an unrecognized status", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "PlanRevision",
            payloadJson: {
              dispositions: [
                { findingId: "F4", status: "dismissed", rationale: "Not relevant" },
                { findingId: "F5", status: "pending", rationale: "Not yet decided" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("dismissed").className).toContain("bg-state-blocked-bg");
    expect(screen.getByText("pending").className).toContain("bg-surface-hover");
  });

  it("shows an empty-dispositions message for a PlanRevision with no dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
        ]}
      />,
    );

    expect(screen.getByText(/no dispositions recorded/i)).toBeDefined();
  });

  it("renders Remediation resolutions and falls back to executionVersion 2 when absent", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [
                {
                  findingId: "F3",
                  status: "rejected",
                  action: "Will not fix",
                  rationale: "Out of scope",
                },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("F3")).toBeDefined();
    expect(screen.getByText("Will not fix")).toBeDefined();
    expect(screen.getByText(/open it to see the v2 report/i)).toBeDefined();
  });

  it("uses the explicit executionVersion from the remediation's executionReport when present", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact({
            type: "Remediation",
            payloadJson: {
              resolution: [],
              executionReport: { executionVersion: 5 },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText(/open it to see the v5 report/i)).toBeDefined();
  });

  it("sorts rejection feedback artifacts descending by plan version and shows their source", () => {
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

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings).toHaveLength(2);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });
});
