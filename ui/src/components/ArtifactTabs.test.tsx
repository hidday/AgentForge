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
    id: overrides.id ?? `${type}-1`,
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
  it("shows an empty state and no tab bar when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet.*run hasn't produced any output/),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the Plan tab by default and dispatches Plan payload to PlanView", () => {
    const artifacts = [
      makeArtifact("Plan", { summary: "The plan summary", steps: [] }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByText("The plan summary")).toBeDefined();
  });

  it("only renders tabs for artifact types that are present", () => {
    const artifacts = [makeArtifact("Plan", { summary: "s" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
  });

  it("switches tab content when a different tab button is clicked", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("Plan", { summary: "Plan summary text" }),
      makeArtifact("Review", { overallVerdict: "approved" }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("Plan summary text")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.queryByText("Plan summary text")).toBeNull();
  });

  it("renders PlanReview artifacts through ReviewView on the Plan Review tab", () => {
    const artifacts = [
      makeArtifact("PlanReview", {
        overallVerdict: "changes_requested",
        summary: "Needs work",
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(screen.getByText("Needs work")).toBeDefined();
  });

  it("renders ExecutionReport artifacts on the Execution tab", () => {
    const artifacts = [
      makeArtifact("ExecutionReport", {
        summary: "Execution done",
        executionVersion: 2,
        filesChanged: ["a.ts", "b.ts"],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Execution done")).toBeDefined();
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
  });

  it("renders PlanRevision dispositions on the Plan Revision tab", () => {
    const artifacts = [
      makeArtifact("PlanRevision", {
        dispositions: [
          {
            findingId: "f1",
            status: "accepted",
            rationale: "Made the change",
          },
          {
            findingId: "f2",
            status: "partially_incorporated",
            rationale: "Did part of it",
          },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
  });

  it("shows 'No dispositions recorded' for an empty PlanRevision", () => {
    const artifacts = [makeArtifact("PlanRevision", { dispositions: [] })];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions and the fallback execution version text", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          {
            findingId: "f1",
            status: "accepted",
            action: "Fixed the bug",
            rationale: "It was broken",
          },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed the bug")).toBeDefined();
    // executionReport absent -> falls back to default version 2 in the note
    expect(screen.getByText(/report\./)).toBeDefined();
  });

  it("renders rejection feedback artifacts sorted by version descending, newest first", () => {
    const artifacts = [
      makeArtifact(
        "RejectionContext",
        { planVersion: 1, feedback: "First rejection", source: "api" },
        { id: "r1", version: 1 },
      ),
      makeArtifact(
        "RejectionContext",
        { planVersion: 2, feedback: "Second rejection", source: "linear" },
        { id: "r2", version: 2 },
      ),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    // Sorted descending by artifact.version: r2 (version 2) should appear before r1
    expect(headings[0].textContent).toContain("V2");
    expect(headings[1].textContent).toContain("V1");
  });

  it("dismisses an unknown/unhandled artifact type from the tab set entirely", () => {
    const artifacts = [makeArtifact("SomeUnknownType", { foo: "bar" })];
    render(<ArtifactTabs artifacts={artifacts} />);
    // No known tab matches an unrecognized artifact type, so we fall
    // back to the empty state rather than rendering a broken tab.
    expect(
      screen.getByText(/No artifacts yet.*run hasn't produced any output/),
    ).toBeDefined();
  });

  it("shows the accepted/dismissed/default disposition status colors correctly", () => {
    const artifacts = [
      makeArtifact("PlanRevision", {
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "r1" },
          { findingId: "f2", status: "dismissed", rationale: "r2" },
          { findingId: "f3", status: "something_else", rationale: "r3" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("something else")).toBeDefined();
  });

  it("shows the rejected and pending resolution status colors in RemediationView", () => {
    const artifacts = [
      makeArtifact("Remediation", {
        resolution: [
          { findingId: "f1", status: "rejected", action: "a1", rationale: "r1" },
          { findingId: "f2", status: "pending", action: "a2", rationale: "r2" },
        ],
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("pending")).toBeDefined();
  });
});
