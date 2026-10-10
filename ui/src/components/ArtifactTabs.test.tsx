import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

let counter = 0;
function makeArtifact(overrides: Partial<Artifact>): Artifact {
  counter += 1;
  return {
    id: `artifact-${counter}`,
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("shows the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("defaults to the first available tab and renders the Plan artifact", () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary text." } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan summary text.")).toBeDefined();
    const planTabButton = screen.getByRole("button", { name: "Plan" });
    expect(planTabButton.className).toContain("bg-accent");
  });

  it("builds a tab for each available artifact type and switches on click", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "Plan body." } }),
      makeArtifact({
        type: "PlanReview",
        payloadJson: { overallVerdict: "approved", summary: "Plan review body." },
      }),
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "d1", status: "accepted", rationale: "Fixed as suggested." },
          ],
        },
      }),
      makeArtifact({
        type: "ExecutionReport",
        payloadJson: { executionVersion: 2, summary: "Execution body." },
      }),
      makeArtifact({
        type: "Review",
        payloadJson: { overallVerdict: "changes_requested", summary: "Code review body." },
      }),
      makeArtifact({
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "r1", status: "accepted", action: "Patched", rationale: "ok" },
          ],
        },
      }),
      makeArtifact({
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "Please redo step 2.", source: "api" },
      }),
    ];

    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan body.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByText("Plan review body.")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("Fixed as suggested.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("Execution body.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Code review body.")).toBeDefined();
    expect(screen.getByText("Changes Requested")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Remediation" }));
    expect(screen.getByText("Patched")).toBeDefined();
    expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();

    await userEvent.click(
      screen.getByRole("button", { name: "Rejection Feedback" }),
    );
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("Please redo step 2.")).toBeDefined();
  });

  it("shows 'No dispositions recorded' when a PlanRevision has an empty dispositions array", () => {
    const artifacts = [
      makeArtifact({ type: "PlanRevision", payloadJson: { dispositions: [] } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("applies the default disposition status style for an unrecognized status", () => {
    const artifacts = [
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "d1", status: "needs_followup", rationale: "Still looking." },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    const badge = screen.getByText("needs followup");
    expect(badge.className).toContain("bg-surface-hover");
  });

  it("colors plan revision dispositions for dismissed and partially_incorporated statuses", () => {
    const artifacts = [
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            { findingId: "d1", status: "dismissed", rationale: "Not applicable." },
            {
              findingId: "d2",
              status: "partially_incorporated",
              rationale: "Partially addressed.",
            },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const dismissed = screen.getByText("dismissed");
    const partial = screen.getByText("partially incorporated");
    expect(dismissed.className).toContain("bg-state-blocked-bg");
    expect(partial.className).toContain("bg-state-waiting-bg");
  });

  it("colors remediation resolutions as accepted, rejected, and other", () => {
    const artifacts = [
      makeArtifact({
        type: "Remediation",
        payloadJson: {
          resolution: [
            { findingId: "r1", status: "accepted", action: "Fix A", rationale: "a" },
            { findingId: "r2", status: "rejected", action: "Fix B", rationale: "b" },
            { findingId: "r3", status: "pending", action: "Fix C", rationale: "c" },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const accepted = screen.getByText("accepted");
    const rejected = screen.getByText("rejected");
    const pending = screen.getByText("pending");
    expect(accepted.className).toContain("bg-state-done-bg");
    expect(rejected.className).toContain("bg-state-blocked-bg");
    expect(pending.className).toContain("bg-state-waiting-bg");
  });

  it("falls back to executionVersion 2 in the remediation note when no executionReport is present", () => {
    const artifacts = [
      makeArtifact({ type: "Remediation", payloadJson: { resolution: [] } }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();
  });

  it("uses the executionReport's executionVersion in the remediation note when present", () => {
    const artifacts = [
      makeArtifact({
        type: "Remediation",
        payloadJson: {
          resolution: [],
          executionReport: { executionVersion: 5 },
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/open it to see the v5 report/)).toBeDefined();
  });

  it("aggregates multiple RejectionContext artifacts sorted descending by version", () => {
    const artifacts = [
      makeArtifact({
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "First rejection.", source: "linear" },
      }),
      makeArtifact({
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Second rejection.", source: "api" },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    const headers = screen.getAllByText(/Rejection$/).map((el) => el.textContent);
    expect(headers).toEqual(["Plan V2 Rejection", "Plan V1 Rejection"]);
    expect(screen.getByText("First rejection.")).toBeDefined();
    expect(screen.getByText("Second rejection.")).toBeDefined();
  });

  it("shows 'No rejection feedback recorded' once the matching artifacts are removed while the tab stays selected", async () => {
    const rejectionArtifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 1, feedback: "A rejection.", source: "api" },
    });
    const planArtifact = makeArtifact({
      type: "Plan",
      payloadJson: { summary: "Plan body." },
    });

    const { rerender } = render(
      <ArtifactTabs artifacts={[planArtifact, rejectionArtifact]} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Rejection Feedback" }),
    );
    expect(screen.getByText("A rejection.")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[planArtifact]} />);

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });

  it("shows 'No data available' when the active tab's artifact is removed via a rerender", async () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      payloadJson: { summary: "Plan body." },
    });
    const reviewArtifact = makeArtifact({
      type: "Review",
      payloadJson: { summary: "Code review body." },
    });

    const { rerender } = render(
      <ArtifactTabs artifacts={[planArtifact, reviewArtifact]} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Code review body.")).toBeDefined();

    rerender(<ArtifactTabs artifacts={[planArtifact]} />);

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
