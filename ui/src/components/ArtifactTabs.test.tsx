import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "art-1",
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
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types that are present, defaulting to the first one", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: { summary: "Plan summary", steps: [] },
      }),
      makeArtifact({
        id: "a2",
        type: "Review",
        payloadJson: { summary: "Review summary", findings: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Defaults to the first available tab (Plan).
    expect(screen.getByText("Plan summary")).toBeDefined();
  });

  it("switches content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: { summary: "Plan summary", steps: [] },
      }),
      makeArtifact({
        id: "a2",
        type: "Review",
        payloadJson: { summary: "Review summary", findings: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("renders the execution report via the Execution tab", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "ExecutionReport",
        payloadJson: { summary: "Execution summary", executionVersion: 3 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Execution summary")).toBeDefined();
    expect(screen.getByText("v3")).toBeDefined();
  });

  describe("Plan Revision tab", () => {
    it("shows an empty state when there are no dispositions", () => {
      const artifacts = [
        makeArtifact({ id: "a1", type: "PlanRevision", payloadJson: { dispositions: [] } }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders each disposition with its status styling", () => {
      const artifacts = [
        makeArtifact({
          id: "a1",
          type: "PlanRevision",
          payloadJson: {
            dispositions: [
              { findingId: "F-1", status: "accepted", rationale: "Looks good" },
              { findingId: "F-2", status: "dismissed", rationale: "Not relevant" },
              { findingId: "F-3", status: "partially_incorporated", rationale: "Some of it" },
              { findingId: "F-4", status: "unknown_status", rationale: "Other" },
            ],
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // underscores are replaced with spaces for display
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
      expect(screen.getByText("Looks good")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling and the execution version note", () => {
      const artifacts = [
        makeArtifact({
          id: "a1",
          type: "Remediation",
          payloadJson: {
            resolution: [
              { findingId: "F-1", status: "accepted", action: "Fixed it", rationale: "r1" },
              { findingId: "F-2", status: "rejected", action: "Declined", rationale: "r2" },
              { findingId: "F-3", status: "pending", action: "TBD", rationale: "r3" },
            ],
            executionReport: { executionVersion: 5 },
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByText("F-1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("pending")).toBeDefined();
      expect(screen.getByText(/v5/)).toBeDefined();
    });

    it("falls back to version 2 in the note when no executionReport version is present", () => {
      const artifacts = [
        makeArtifact({
          id: "a1",
          type: "Remediation",
          payloadJson: { resolution: [] },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/v2/)).toBeDefined();
    });
  });

  describe("Rejection Feedback tab", () => {
    it("sorts rejection artifacts by version descending and shows their source badge", () => {
      const artifacts = [
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

      // Default tab is the only available one: Rejection Feedback.
      expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("Second rejection")).toBeDefined();
      expect(screen.getByText("First rejection")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings[0].textContent).toBe("Plan V2 Rejection");
      expect(headings[1].textContent).toBe("Plan V1 Rejection");
    });
  });

  it("renders the Plan Review tab content via ReviewView", () => {
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "PlanReview",
        payloadJson: { summary: "Plan review summary", overallVerdict: "approved", findings: [] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Plan review summary")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
  });
});
