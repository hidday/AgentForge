import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(
  type: string,
  payloadJson: unknown,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id: overrides.id ?? `${type}-${overrides.version ?? 1}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: "",
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./),
    ).toBeDefined();
  });

  it("only shows tabs for artifact types that exist, defaulting to the first available tab", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Review", { overallVerdict: "approved" })]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(reviewTab).toBeDefined();
    // Should default to showing the only available tab's content.
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders the Plan tab content by default when a Plan artifact exists", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", { planVersion: 1, summary: "Plan summary" })]}
      />,
    );
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("switches tab content when a different tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "The plan" }),
          makeArtifact("ExecutionReport", {
            summary: "The execution",
            executionVersion: 1,
          }),
        ]}
      />,
    );

    expect(screen.getByText("The plan")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("The execution")).toBeDefined();
    expect(screen.queryByText("The plan")).toBeNull();
  });

  it("renders the PlanRevision tab with finding dispositions", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Makes sense" },
              { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
              {
                findingId: "F3",
                status: "partially_incorporated",
                rationale: "Partly addressed",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    // Underscores in status are replaced with spaces for display.
    expect(screen.getByText("partially incorporated")).toBeDefined();
  });

  it("shows a fallback message when PlanRevision has no dispositions", () => {
    render(
      <ArtifactTabs artifacts={[makeArtifact("PlanRevision", { dispositions: [] })]} />,
    );
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders the Remediation tab with resolutions and a fallback execution version note", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              {
                findingId: "F1",
                status: "accepted",
                action: "Fixed null check",
                rationale: "Was unsafe",
              },
              {
                findingId: "F2",
                status: "rejected",
                action: "No change",
                rationale: "Not applicable",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed null check")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    // executionReport missing -> falls back to v2 in the footer note.
    expect(screen.getByText("report.", { exact: false })).toBeDefined();
  });

  it("renders rejection feedback sorted by plan version descending, with its source badge", () => {
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

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("orders available tabs by the fixed TABS order regardless of artifact order", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Review", { summary: "Review text" }),
          makeArtifact("Plan", { summary: "Plan text" }),
        ]}
      />,
    );
    const tabButtons = screen.getAllByRole("button");
    const labels = tabButtons.map((b) => b.textContent);
    expect(labels.indexOf("Plan")).toBeLessThan(labels.indexOf("Code Review"));
  });
});
