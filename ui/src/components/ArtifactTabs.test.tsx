import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(
  type: string,
  payloadJson: unknown,
  id = `${type}-1`,
  version = 1,
): Artifact {
  return {
    id,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/No artifacts yet/i)).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Plan", { summary: "The plan" })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
  });

  it("defaults to the first available tab and renders its content", () => {
    render(
      <ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "The plan" })]} />,
    );
    expect(screen.getByText("The plan")).toBeDefined();
  });

  it("switches tabs on click and renders the newly active tab's content", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "Plan summary" }),
          makeArtifact("Review", { summary: "Review summary" }),
        ]}
      />,
    );
    expect(screen.getByText("Plan summary")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("renders PlanReview artifacts through ReviewView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("PlanReview", { overallVerdict: "approved" })]}
      />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders ExecutionReport artifacts through ExecutionReportView", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { executionVersion: 4 })]}
      />,
    );
    expect(screen.getByText("v4")).toBeDefined();
  });

  describe("PlanRevision tab", () => {
    it("shows 'No dispositions recorded' when dispositions is empty", () => {
      render(
        <ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />,
      );
      expect(screen.getByText("No dispositions recorded")).toBeDefined();
    });

    it("renders dispositions with status-specific styling for each known status", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("PlanRevision", {
              dispositions: [
                { findingId: "f1", status: "accepted", rationale: "Fixed it" },
                { findingId: "f2", status: "dismissed", rationale: "Not applicable" },
                {
                  findingId: "f3",
                  status: "partially_incorporated",
                  rationale: "Partly addressed",
                },
                { findingId: "f4", status: "deferred", rationale: "Later" },
              ],
            }),
          ]}
        />,
      );
      expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
      expect(screen.getByText("f1")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
      // underscore replaced with a space in the rendered status label
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("Remediation", {
              resolution: [
                { findingId: "f1", status: "accepted", action: "Fixed", rationale: "r1" },
                { findingId: "f2", status: "rejected", action: "Won't fix", rationale: "r2" },
                { findingId: "f3", status: "pending", action: "TBD", rationale: "r3" },
              ],
            }),
          ]}
        />,
      );
      expect(screen.getByText("Resolutions")).toBeDefined();
      expect(screen.getByText("Fixed")).toBeDefined();
      expect(screen.getByText("Won't fix")).toBeDefined();
      expect(screen.getByText("TBD")).toBeDefined();
    });

    it("shows the executionVersion from the nested executionReport when present", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("Remediation", {
              resolution: [],
              executionReport: { executionVersion: 7 },
            }),
          ]}
        />,
      );
      expect(screen.getByText(/v7 report/)).toBeDefined();
    });

    it("falls back to executionVersion 2 when no executionReport is present", () => {
      render(
        <ArtifactTabs artifacts={[makeArtifact("Remediation", { resolution: [] })]} />,
      );
      expect(screen.getByText(/v2 report/)).toBeDefined();
    });
  });

  describe("Rejection Feedback tab", () => {
    it("renders a single rejection's plan version, feedback, and source", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact("RejectionContext", {
              planVersion: 1,
              feedback: "Needs work",
              source: "api",
            }),
          ]}
        />,
      );
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("Needs work")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
    });

    it("sorts multiple rejection artifacts by version, descending", () => {
      render(
        <ArtifactTabs
          artifacts={[
            makeArtifact(
              "RejectionContext",
              { planVersion: 1, feedback: "First rejection", source: "linear" },
              "rc-1",
              1,
            ),
            makeArtifact(
              "RejectionContext",
              { planVersion: 2, feedback: "Second rejection", source: "api" },
              "rc-2",
              2,
            ),
          ]}
        />,
      );

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings[0].textContent).toBe("Plan V2 Rejection");
      expect(headings[1].textContent).toBe("Plan V1 Rejection");
    });
  });
});
