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
    id: overrides.id ?? `${type}-${Math.random()}`,
    runId: "run-1",
    type,
    version: overrides.version ?? 1,
    payloadJson,
    rawText: "",
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs – additional branch coverage", () => {
  it("renders the PlanReview artifact type under the shared ReviewView component", () => {
    const planReview = makeArtifact("PlanReview", {
      overallVerdict: "approved",
      summary: "Plan review summary",
      findings: [],
    });
    render(<ArtifactTabs artifacts={[planReview]} />);

    expect(screen.getByRole("button", { name: "Plan Review" })).toBeDefined();
    expect(screen.getByText("Plan review summary")).toBeDefined();
  });

  it("falls back to 'No data available' when the active tab's artifact disappears on rerender", async () => {
    const plan = makeArtifact("Plan", { summary: "Plan summary" });
    const review = makeArtifact("Review", { summary: "Review summary", findings: [] });
    const { rerender } = render(<ArtifactTabs artifacts={[plan, review]} />);

    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    await userEvent.click(reviewTab);

    // Re-render with the Review artifact removed while "review" is still
    // the active tab (e.g. a refetch that races ahead of a tab switch).
    rerender(<ArtifactTabs artifacts={[plan]} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("falls back to 'No rejection feedback recorded' when rejection artifacts disappear on rerender", async () => {
    const rejection = makeArtifact("RejectionContext", {
      planVersion: 1,
      feedback: "Needs rework",
      source: "api",
    });
    const plan = makeArtifact("Plan", { summary: "Plan summary" });
    const { rerender } = render(<ArtifactTabs artifacts={[plan, rejection]} />);

    const rejectionTab = screen.getByRole("button", { name: "Rejection Feedback" });
    await userEvent.click(rejectionTab);
    expect(screen.getByText("Needs rework")).toBeDefined();

    // Re-render with the rejection artifact gone while "rejectionFeedback"
    // is still the active tab.
    rerender(<ArtifactTabs artifacts={[plan]} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("styles a 'partially_incorporated' disposition distinctly from accepted/dismissed", () => {
    const revision = makeArtifact("PlanRevision", {
      dispositions: [
        { findingId: "f1", status: "partially_incorporated", rationale: "Half done" },
      ],
    });
    render(<ArtifactTabs artifacts={[revision]} />);

    const badge = screen.getByText("partially incorporated");
    expect(badge.className).toContain("bg-state-waiting-bg");
  });

  it("falls back to the default disposition style for an unrecognized status", () => {
    const revision = makeArtifact("PlanRevision", {
      dispositions: [{ findingId: "f1", status: "unreviewed", rationale: "tbd" }],
    });
    render(<ArtifactTabs artifacts={[revision]} />);

    const badge = screen.getByText("unreviewed");
    expect(badge.className).toContain("bg-surface-hover");
  });

  it("renders the Resolutions heading with no items when remediation has no resolution field", () => {
    const remediation = makeArtifact("Remediation", {});
    render(<ArtifactTabs artifacts={[remediation]} />);

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();
  });

  it("styles rejected and other-status remediation resolutions distinctly from accepted", () => {
    const remediation = makeArtifact("Remediation", {
      resolution: [
        { findingId: "f1", status: "rejected", action: "Reverted", rationale: "Too risky" },
        { findingId: "f2", status: "pending", action: "Will fix", rationale: "Tracked" },
      ],
    });
    render(<ArtifactTabs artifacts={[remediation]} />);

    const rejectedBadge = screen.getByText("rejected");
    expect(rejectedBadge.className).toContain("bg-state-blocked-bg");
    const pendingBadge = screen.getByText("pending");
    expect(pendingBadge.className).toContain("bg-state-waiting-bg");
  });
});
