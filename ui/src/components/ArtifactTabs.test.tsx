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
    id: overrides.id ?? `${type}-${Math.random().toString(36).slice(2)}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(screen.getByText(/no artifacts yet/i)).toBeDefined();
  });

  it("renders a single available tab and its content, defaulting to the first tab", () => {
    const plan = makeArtifact("Plan", { planVersion: 3, summary: "Do the thing", steps: [] });
    render(<ArtifactTabs artifacts={[plan]} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    // Only the Plan tab should be rendered
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("switches content when clicking between multiple available tabs", async () => {
    const plan = makeArtifact("Plan", { planVersion: 1, steps: [] });
    const review = makeArtifact("Review", {
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    });
    const execution = makeArtifact("ExecutionReport", {
      executionVersion: 2,
      summary: "Implemented",
      filesChanged: [],
      notes: [],
    });

    render(<ArtifactTabs artifacts={[plan, review, execution]} />);

    // Defaults to the first matching tab in TABS order: Plan
    expect(screen.getByText("v1")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText(/looks good/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText(/implemented/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("maps the PlanReview artifact type onto the shared ReviewView", async () => {
    const planReview = makeArtifact("PlanReview", {
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [],
    });
    render(<ArtifactTabs artifacts={[planReview]} />);
    expect(screen.getByText(/needs work/i)).toBeDefined();
  });

  it("renders 'No data available' when the active tab's artifact disappears after an update", () => {
    const plan = makeArtifact("Plan", { planVersion: 1, steps: [] });
    const review = makeArtifact("Review", { summary: "ok", findings: [] });

    const { rerender } = render(<ArtifactTabs artifacts={[review, plan]} />);
    // Default tab is "plan" (first in TABS order among available types)
    expect(screen.getByText("v1")).toBeDefined();

    // Artifacts refresh and no longer include a Plan artifact, while Review
    // still exists — the previously active "plan" tab's content is now gone.
    rerender(<ArtifactTabs artifacts={[review]} />);
    expect(screen.getByText(/no data available/i)).toBeDefined();
  });

  describe("PlanRevision tab", () => {
    it("shows 'No dispositions recorded' when there are none", () => {
      const revision = makeArtifact("PlanRevision", { dispositions: [] });
      render(<ArtifactTabs artifacts={[revision]} />);
      expect(screen.getByText(/no dispositions recorded/i)).toBeDefined();
    });

    it("renders each disposition with its status styling", () => {
      const revision = makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "accepted", rationale: "Fixed" },
          { findingId: "F2", status: "dismissed", rationale: "Not applicable" },
          { findingId: "F3", status: "partially_incorporated", rationale: "Partially done" },
          { findingId: "F4", status: "unknown_status", rationale: "Fallback style" },
        ],
      });
      render(<ArtifactTabs artifacts={[revision]} />);

      expect(screen.getByText("F1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("dismissed")).toBeDefined();
      // Underscores in the status are rendered as spaces
      expect(screen.getByText("partially incorporated")).toBeDefined();
      expect(screen.getByText("unknown status")).toBeDefined();
      expect(screen.getByText("Fixed")).toBeDefined();
    });
  });

  describe("Remediation tab", () => {
    it("renders resolutions with accepted/rejected/other status styling", () => {
      const remediation = makeArtifact("Remediation", {
        resolution: [
          { findingId: "R1", status: "accepted", action: "Patched", rationale: "Was valid" },
          { findingId: "R2", status: "rejected", action: "No-op", rationale: "Not valid" },
          { findingId: "R3", status: "deferred", action: "Tracked", rationale: "Later" },
        ],
      });
      render(<ArtifactTabs artifacts={[remediation]} />);

      expect(screen.getByText("R1")).toBeDefined();
      expect(screen.getByText("accepted")).toBeDefined();
      expect(screen.getByText("rejected")).toBeDefined();
      expect(screen.getByText("deferred")).toBeDefined();
      expect(screen.getByText("Patched")).toBeDefined();
    });

    it("falls back to execution version 2 when no executionReport is present", () => {
      const remediation = makeArtifact("Remediation", { resolution: [] });
      render(<ArtifactTabs artifacts={[remediation]} />);
      expect(screen.getByText(/open it to see the v2 report/i)).toBeDefined();
    });

    it("uses the executionReport's executionVersion when present", () => {
      const remediation = makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      });
      render(<ArtifactTabs artifacts={[remediation]} />);
      expect(screen.getByText(/open it to see the v5 report/i)).toBeDefined();
    });
  });

  describe("Rejection feedback tab", () => {
    it("sorts multiple rejection artifacts by version, descending", async () => {
      const r1 = makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { id: "rej-1", version: 1 },
      );
      const r2 = makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        { id: "rej-2", version: 2 },
      );
      const plan = makeArtifact("Plan", { planVersion: 1, steps: [] });

      render(<ArtifactTabs artifacts={[plan, r1, r2]} />);

      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));

      const headings = screen.getAllByText(/Plan V\d Rejection/);
      expect(headings).toHaveLength(2);
      // Highest version (2) should be rendered first
      expect(headings[0].textContent).toContain("Plan V2 Rejection");
      expect(headings[1].textContent).toContain("Plan V1 Rejection");
      expect(screen.getByText("First rejection")).toBeDefined();
      expect(screen.getByText("Second rejection")).toBeDefined();
      expect(screen.getByText("api")).toBeDefined();
      expect(screen.getByText("linear")).toBeDefined();
    });

    it("shows 'No rejection feedback recorded' once the rejection artifacts disappear", async () => {
      const r1 = makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { id: "rej-1" },
      );
      const plan = makeArtifact("Plan", { planVersion: 1, steps: [] });

      const { rerender } = render(<ArtifactTabs artifacts={[plan, r1]} />);
      await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
      expect(screen.getByText("First rejection")).toBeDefined();

      // Artifacts refresh and the rejection record is gone, but Plan remains
      // so the overall empty state does not take over.
      rerender(<ArtifactTabs artifacts={[plan]} />);
      expect(screen.getByText(/no rejection feedback recorded/i)).toBeDefined();
    });
  });

});
