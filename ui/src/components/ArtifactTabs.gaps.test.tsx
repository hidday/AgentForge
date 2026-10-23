import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

import { ArtifactTabs } from "./ArtifactTabs.tsx";

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
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs gaps", () => {
  it("shows 'No rejection feedback recorded' when the active tab's artifacts disappear from props while still selected", async () => {
    const withRejection = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "Please redo", source: "api" },
        { id: "rc1", version: 1 },
      ),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={withRejection} />);

    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    expect(screen.getByText("Please redo")).toBeDefined();

    // Re-render with the RejectionContext artifact gone (e.g. a fresh run load).
    // The "Rejection Feedback" tab button disappears, but the component's
    // activeTab state still points at it, so the body must fall back to the
    // "no feedback" message instead of crashing or rendering stale content.
    const withoutRejection = [makeArtifact("Plan", { planVersion: 1 })];
    rerender(<ArtifactTabs artifacts={withoutRejection} />);

    expect(screen.queryByRole("button", { name: "Rejection Feedback" })).toBeNull();
    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("styles a 'partially_incorporated' disposition distinctly and falls back to a muted style for an unknown status", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "F1", status: "partially_incorporated", rationale: "Partly addressed" },
          { findingId: "F2", status: "some_future_status", rationale: "Unrecognized" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    const partial = screen.getByText("partially incorporated");
    expect(partial.className).toContain("bg-state-waiting-bg");

    const unknown = screen.getByText("some future status");
    expect(unknown.className).toContain("bg-surface-hover");
  });

  it("shows 'No data available' for a non-rejection tab whose artifact disappears from props while still selected", async () => {
    const withExecution = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("ExecutionReport", { summary: "v1 done" }, { id: "exec1", version: 1 }),
    ];
    const { rerender } = render(<ArtifactTabs artifacts={withExecution} />);

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("v1 done")).toBeDefined();

    // Now the ExecutionReport artifact disappears, but "execution" is still
    // the selected tab and its button no longer renders.
    rerender(<ArtifactTabs artifacts={[makeArtifact("Plan", { planVersion: 1 })]} />);

    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("renders the Plan Review tab via ReviewView for a PlanReview artifact", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanReview", { overallVerdict: "changes_requested" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("defaults dispositions to an empty list (showing 'No dispositions recorded') when the field is entirely absent", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("PlanRevision", {}),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("defaults resolution to an empty list and the execution version to 2 when fields are absent, and styles a 'rejected' resolution", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "F1", status: "rejected", action: "Declined fix", rationale: "Out of scope" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    const rejected = screen.getByText("rejected");
    expect(rejected.className).toContain("bg-state-blocked-bg");
    // No executionReport field at all, so the fallback version (2) is used.
    expect(screen.getByText(/v\s*2\s*report\.?/)).toBeDefined();
  });

  it("styles a resolution status that is neither 'accepted' nor 'rejected' with the waiting/muted style", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "F1", status: "deferred", action: "Will revisit later", rationale: "Low priority" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    const deferred = screen.getByText("deferred");
    expect(deferred.className).toContain("bg-state-waiting-bg");
  });

  it("shows no resolutions when the Remediation artifact omits the resolution field entirely", async () => {
    const artifacts = [
      makeArtifact("Plan", { planVersion: 1 }),
      makeArtifact("Remediation", {}),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));

    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.queryByText(/F1|F2/)).toBeNull();
  });
});
