import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(
  type: string,
  payload: unknown,
  version = 1,
  id = `${type}-${version}`,
): Artifact {
  return {
    id,
    runId: "r1",
    type,
    version,
    payloadJson: payload,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("shows only the tabs that have a matching artifact, and renders the first one's content by default", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "Plan summary text" }),
      makeArtifact("ExecutionReport", { summary: "Execution summary text" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("switches content when a different tab is clicked", async () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "Plan summary text" }),
      makeArtifact("Review", { summary: "Review summary text" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan summary text")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Review summary text")).toBeDefined();
    expect(screen.queryByText("Plan summary text")).toBeNull();
  });

  it("renders PlanReview artifacts through the Review view", () => {
    const artifacts = [makeArtifact("PlanReview", { summary: "Plan review notes" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Plan review notes")).toBeDefined();
  });

  it("renders dispositions for a PlanRevision artifact, including all status styles", () => {
    const artifacts = [
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "Makes sense" },
          { findingId: "f2", status: "dismissed", rationale: "Not applicable" },
          { findingId: "f3", status: "partially_incorporated", rationale: "Partial fix" },
          { findingId: "f4", status: "unknown_status", rationale: "Fallback style" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("Makes sense")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("shows a 'no dispositions' message for an empty PlanRevision", () => {
    const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders resolutions for a Remediation artifact with accepted, rejected, and other statuses", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed null check", rationale: "r1" },
          { findingId: "f2", status: "rejected", action: "No change", rationale: "r2" },
          { findingId: "f3", status: "deferred", action: "Will follow up", rationale: "r3" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed null check")).toBeDefined();
    expect(screen.getByText("No change")).toBeDefined();
    expect(screen.getByText("Will follow up")).toBeDefined();
  });

  it("defaults the remediation note's execution version to 2 when not specified", () => {
    const artifacts = [makeArtifact("Remediation", { resolution: [] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/open it to see the v2 report/)).toBeDefined();
  });

  it("uses the explicit execution version in the remediation note when present", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [],
        executionReport: { executionVersion: 5 },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText(/open it to see the v5 report/)).toBeDefined();
  });

  it("shows all rejection feedback artifacts sorted by version descending", () => {
    const artifacts = [
      makeArtifact("RejectionContext", { planVersion: 1, feedback: "first rejection", source: "api" }, 1),
      makeArtifact("RejectionContext", { planVersion: 2, feedback: "second rejection", source: "linear" }, 2),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByRole("button", { name: "Rejection Feedback" })).toBeDefined();

    const headers = screen.getAllByText(/Plan V\d Rejection/);
    expect(headers[0].textContent).toBe("Plan V2 Rejection");
    expect(headers[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("second rejection")).toBeDefined();
    expect(screen.getByText("first rejection")).toBeDefined();
  });
});
