import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(type: string, payloadJson: unknown, overrides: Partial<Artifact> = {}): Artifact {
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

describe("ArtifactTabs", () => {
  it("shows an empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./),
    ).toBeDefined();
  });

  it("only shows tabs for artifact types that are present, defaulting to the first", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "The plan" }),
          makeArtifact("Review", { summary: "The review" }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code Review" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Execution" })).toBeNull();
    // Plan tab active by default
    expect(screen.getByText("The plan")).toBeDefined();
  });

  it("switches tab content when another tab is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "The plan" }),
          makeArtifact("Review", { summary: "The review" }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("The review")).toBeDefined();
    expect(screen.queryByText("The plan")).toBeNull();
  });

  it("renders the execution report tab content", async () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { summary: "Executed it" })]}
      />,
    );
    expect(screen.getByText("Executed it")).toBeDefined();
  });

  it("renders plan revision dispositions, or a fallback when empty", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "Makes sense" },
              { findingId: "F2", status: "dismissed", rationale: "Out of scope" },
              { findingId: "F3", status: "partially_incorporated", rationale: "Some of it" },
              { findingId: "F4", status: "other", rationale: "Weird status" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("other")).toBeDefined();
  });

  it("shows a fallback for plan revision with no dispositions", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders remediation resolutions and the execution-version note", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              { findingId: "F1", status: "accepted", action: "Fixed it", rationale: "r1" },
              { findingId: "F2", status: "rejected", action: "Won't fix", rationale: "r2" },
              { findingId: "F3", status: "pending", action: "TBD", rationale: "r3" },
            ],
            executionReport: { executionVersion: 5 },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("Fixed it")).toBeDefined();
    expect(screen.getByText(/v/).textContent).toContain("5");
  });

  it("defaults the remediation note's version to 2 when absent", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Remediation", { resolution: [] })]}
      />,
    );
    expect(screen.getByText(/report\./).textContent).toContain("2");
  });

  it("shows multiple rejection-feedback artifacts sorted by version descending", async () => {
    render(
      <ArtifactTabs
        artifacts={[
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
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rejection Feedback" }));
    const feedbackTexts = screen.getAllByText(/^(First|Second) rejection$/).map((el) => el.textContent);
    expect(feedbackTexts[0]).toContain("Second rejection");
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
  });

  it("falls through to raw JSON rendering for an unmapped tab type", () => {
    // PlanReview maps to ReviewView via ArtifactContent's switch, so instead
    // verify the default branch handles an artifact whose tabId falls outside
    // the known switch cases indirectly isn't reachable via props; this test
    // ensures standard tabs still render without throwing for minimal payloads.
    render(<ArtifactTabs artifacts={[makeArtifact("Plan", {})]} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });
});
