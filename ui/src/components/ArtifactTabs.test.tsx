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

describe("ArtifactTabs", () => {
  it("renders the empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders only a tab button for artifact types present, and shows its content", () => {
    const plan = makeArtifact("Plan", {
      planVersion: 2,
      summary: "Implement the feature",
      steps: [{ id: "s1", title: "Step one", description: "do the first thing" }],
    });
    render(<ArtifactTabs artifacts={[plan]} />);

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Code Review" })).toBeNull();
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
  });

  it("marks the initially active tab with the active style and switches on click", async () => {
    const plan = makeArtifact("Plan", { summary: "Plan summary" });
    const review = makeArtifact("Review", {
      overallVerdict: "changes_requested",
      summary: "Review summary",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Missing null check",
          details: "Could throw at runtime",
        },
      ],
    });
    render(<ArtifactTabs artifacts={[plan, review]} />);

    const planTab = screen.getByRole("button", { name: "Plan" });
    const reviewTab = screen.getByRole("button", { name: "Code Review" });
    expect(planTab.className).toContain("bg-accent");
    expect(reviewTab.className).not.toContain("bg-accent");
    expect(screen.getByText("Plan summary")).toBeDefined();

    await userEvent.click(reviewTab);

    expect(reviewTab.className).toContain("bg-accent");
    expect(planTab.className).not.toContain("bg-accent");
    expect(screen.getByText("Review summary")).toBeDefined();
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.queryByText("Plan summary")).toBeNull();
  });

  it("renders execution report content under the Execution tab", async () => {
    const execution = makeArtifact("ExecutionReport", {
      executionVersion: 3,
      summary: "Implemented the change",
      filesChanged: ["src/a.ts", "src/b.ts"],
      checks: { lint: { status: "pass", details: "no issues" } },
      notes: ["Remember to update docs"],
      prDraftCreated: true,
    });
    render(<ArtifactTabs artifacts={[execution]} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it("renders remediation resolutions under the Remediation tab", () => {
    const remediation = makeArtifact("Remediation", {
      resolution: [
        {
          findingId: "f1",
          status: "accepted",
          action: "Added null check",
          rationale: "Prevents crash",
        },
      ],
      executionReport: { executionVersion: 4 },
    });
    render(<ArtifactTabs artifacts={[remediation]} />);

    expect(screen.getByRole("button", { name: "Remediation" })).toBeDefined();
    expect(screen.getByText("Added null check")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText(/v4/)).toBeDefined();
  });

  it("shows the empty-dispositions message for a plan revision with no dispositions", () => {
    const revision = makeArtifact("PlanRevision", {});
    render(<ArtifactTabs artifacts={[revision]} />);

    expect(screen.getByRole("button", { name: "Plan Revision" })).toBeDefined();
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders plan revision dispositions when present", () => {
    const revision = makeArtifact("PlanRevision", {
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Makes sense" },
        { findingId: "f2", status: "dismissed", rationale: "Out of scope" },
      ],
    });
    render(<ArtifactTabs artifacts={[revision]} />);

    expect(screen.getByText("f1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("f2")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
  });

  it("sorts multiple rejection-feedback artifacts by version descending", () => {
    const rejection1 = makeArtifact(
      "RejectionContext",
      { planVersion: 1, feedback: "First rejection", source: "api" },
      { id: "r1", version: 1 },
    );
    const rejection2 = makeArtifact(
      "RejectionContext",
      { planVersion: 2, feedback: "Second rejection", source: "linear" },
      { id: "r2", version: 2 },
    );
    render(<ArtifactTabs artifacts={[rejection1, rejection2]} />);

    const tab = screen.getByRole("button", { name: "Rejection Feedback" });
    expect(tab).toBeDefined();

    const headings = screen.getAllByText(/Plan V\d Rejection/);
    expect(headings[0].textContent).toBe("Plan V2 Rejection");
    expect(headings[1].textContent).toBe("Plan V1 Rejection");
    expect(screen.getByText("Second rejection")).toBeDefined();
    expect(screen.getByText("First rejection")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
  });

  it("renders tabs for all distinct artifact types in a mixed set, in a fixed order", () => {
    const review = makeArtifact("Review", { summary: "r" });
    const plan = makeArtifact("Plan", { summary: "p" });
    render(<ArtifactTabs artifacts={[review, plan]} />);

    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    // "Plan" precedes "Code Review" in TABS regardless of artifact input order
    expect(buttons.indexOf("Plan")).toBeLessThan(buttons.indexOf("Code Review"));
  });
});
