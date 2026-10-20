import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Artifact } from "@/api/client.ts";

import { ArtifactTabs } from "./ArtifactTabs.tsx";

function makeArtifact(overrides: Partial<Artifact> & { type: string }): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/no artifacts yet/i)).toBeDefined();
  });

  it("shows the empty state when artifacts exist but none match a known tab type", () => {
    render(<ArtifactTabs artifacts={[makeArtifact({ type: "SomethingUnknown" })]} />);
    expect(screen.getByText(/no artifacts yet/i)).toBeDefined();
  });

  it("renders only the tabs for artifact types present, defaulting to the first available tab", () => {
    const artifacts = [
      makeArtifact({ id: "p1", type: "Plan", payloadJson: { summary: "Plan summary text" } }),
      makeArtifact({ id: "r1", type: "Review", payloadJson: { summary: "Review summary text" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();

    // Plan tab is first in TABS order, so it should be active/default
    expect(screen.getByText("Plan summary text")).toBeDefined();
    expect(screen.queryByText("Review summary text")).toBeNull();
  });

  it("switches content when a different tab is clicked", () => {
    const artifacts = [
      makeArtifact({ id: "p1", type: "Plan", payloadJson: { summary: "Plan summary text" } }),
      makeArtifact({ id: "r1", type: "Review", payloadJson: { summary: "Review summary text" } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    fireEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary text")).toBeDefined();
    expect(screen.queryByText("Plan summary text")).toBeNull();
  });

  it("renders the Plan tab content via PlanView", () => {
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: { summary: "A clear plan", planVersion: 3, confidence: 0.9 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("A clear plan")).toBeDefined();
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the Plan Review tab content via ReviewView", () => {
    const artifacts = [
      makeArtifact({
        type: "PlanReview",
        payloadJson: { overallVerdict: "approved", summary: "Looks solid" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Looks solid")).toBeDefined();
  });

  it("renders the Code Review tab content via ReviewView with changes requested", () => {
    const artifacts = [
      makeArtifact({
        type: "Review",
        payloadJson: { overallVerdict: "changes_requested", summary: "Needs work" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the Execution tab content via ExecutionReportView", () => {
    const artifacts = [
      makeArtifact({
        type: "ExecutionReport",
        payloadJson: { summary: "Execution done", executionVersion: 2, filesChanged: ["a.ts"] },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Execution done")).toBeDefined();
    expect(screen.getByText("v2")).toBeDefined();
  });

  describe("Plan Revision tab", () => {
    it("shows 'No dispositions recorded' when dispositions is empty", () => {
      const artifacts = [
        makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/no dispositions recorded/i)).toBeDefined();
    });

    it("renders dispositions with status styling for each known status and a default style for unknown ones", () => {
      const artifacts = [
        makeArtifact({
          type: "PlanRevision",
          payloadJson: {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Fixed it" },
              { findingId: "F2", status: "dismissed", rationale: "Not relevant" },
              { findingId: "F3", status: "partially_incorporated", rationale: "Partly done" },
              { findingId: "F4", status: "unknown_status", rationale: "Weird one" },
            ],
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
      expect(screen.getByText("Fixed it")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted, rejected and other status styling", () => {
      const artifacts = [
        makeArtifact({
          type: "Remediation",
          payloadJson: {
            resolution: [
              { findingId: "F1", status: "accepted", action: "Fixed", rationale: "r1" },
              { findingId: "F2", status: "rejected", action: "Ignored", rationale: "r2" },
              { findingId: "F3", status: "deferred", action: "Later", rationale: "r3" },
            ],
          },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText("Fixed")).toBeDefined();
      expect(screen.getByText("Ignored")).toBeDefined();
      expect(screen.getByText("Later")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
    });

    it("falls back to v2 in the execution-report pointer note when executionVersion is absent", () => {
      const artifacts = [
        makeArtifact({ type: "Remediation", payloadJson: { resolution: [] } }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/open it to see the v2 report/i)).toBeDefined();
    });

    it("uses the executionReport's executionVersion in the pointer note when present", () => {
      const artifacts = [
        makeArtifact({
          type: "Remediation",
          payloadJson: { resolution: [], executionReport: { executionVersion: 5 } },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);
      expect(screen.getByText(/open it to see the v5 report/i)).toBeDefined();
    });
  });

  describe("Rejection Feedback tab", () => {
    it("sorts rejection artifacts by version descending and shows their source badge", () => {
      const artifacts = [
        makeArtifact({
          id: "rc1",
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "First rejection", source: "api" },
        }),
        makeArtifact({
          id: "rc2",
          type: "RejectionContext",
          version: 2,
          payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear" },
        }),
      ];
      render(<ArtifactTabs artifacts={artifacts} />);

      expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();
      expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings[0].textContent).toBe("Plan V2 Rejection");
      expect(headings[1].textContent).toBe("Plan V1 Rejection");
    });

    it("shows 'No rejection feedback recorded' once the active rejection-feedback tab has no matching artifacts left", () => {
      // Mount with only a RejectionContext artifact so "rejectionFeedback"
      // becomes (and stays, via component state) the active tab.
      const { rerender } = render(
        <ArtifactTabs
          artifacts={[
            makeArtifact({
              type: "RejectionContext",
              payloadJson: { planVersion: 1, feedback: "Feedback", source: "api" },
            }),
          ]}
        />,
      );
      expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

      // Swap in artifacts that still render a tab bar (Plan) but no longer
      // include any RejectionContext artifact; activeTab state persists.
      rerender(<ArtifactTabs artifacts={[makeArtifact({ type: "Plan", payloadJson: {} })]} />);

      expect(screen.getByText(/no rejection feedback recorded/i)).toBeDefined();
    });
  });

  it("shows 'No data available' when the active tab's artifact type disappears on rerender", () => {
    const { rerender } = render(
      <ArtifactTabs artifacts={[makeArtifact({ type: "Plan", payloadJson: { summary: "S" } })]} />,
    );
    expect(screen.getByText("S")).toBeDefined();

    // Swap entirely to a Review artifact; the Plan tab button disappears but
    // the "plan" activeTab state from mount is retained internally.
    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact({ type: "Review", payloadJson: { summary: "R" } })]}
      />,
    );

    expect(screen.getByText(/no data available/i)).toBeDefined();
  });
});
