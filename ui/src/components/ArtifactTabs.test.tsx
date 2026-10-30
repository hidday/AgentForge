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
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactTabs", () => {
  it("renders empty state when there are no artifacts", () => {
    render(<ArtifactTabs artifacts={[]} />);
    expect(
      screen.getByText(/No artifacts yet — the run hasn't produced any output\./),
    ).toBeDefined();
  });

  it("only renders tabs for artifact types present, defaulting to the first available", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { summary: "exec summary" })]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Execution" })).toBeDefined();
    expect(screen.getByText("exec summary")).toBeDefined();
  });

  it("switches active tab content when a different tab button is clicked", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "the plan" }),
          makeArtifact("Review", { summary: "the review" }),
        ]}
      />,
    );
    expect(screen.getByText("the plan")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Code Review" }));

    expect(screen.getByText("the review")).toBeDefined();
    expect(screen.queryByText("the plan")).toBeNull();
  });

  it("renders PlanReview artifacts under the Plan Review tab via ReviewView", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "plan body" }),
          makeArtifact("PlanReview", { summary: "plan review body" }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan Review" }));
    expect(screen.getByText("plan review body")).toBeDefined();
  });

  it("renders PlanRevision dispositions, empty state, and unknown-status styling", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "looks good" },
              { findingId: "F2", status: "dismissed", rationale: "not applicable" },
              {
                findingId: "F3",
                status: "partially_incorporated",
                rationale: "partial",
              },
              { findingId: "F4", status: "unknown_status", rationale: "weird" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeDefined();
    expect(screen.getByText("F1")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("partially incorporated")).toBeDefined();
    expect(screen.getByText("unknown status")).toBeDefined();
  });

  it("renders 'No dispositions recorded' when PlanRevision has an empty dispositions array", () => {
    render(<ArtifactTabs artifacts={[makeArtifact("PlanRevision", {})]} />);
    expect(screen.getByText("No dispositions recorded")).toBeDefined();
  });

  it("renders Remediation resolutions with accepted, rejected, and other status styling", () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Remediation", {
            resolution: [
              {
                findingId: "F1",
                status: "accepted",
                action: "fixed it",
                rationale: "rationale A",
              },
              {
                findingId: "F2",
                status: "rejected",
                action: "won't fix",
                rationale: "rationale B",
              },
              {
                findingId: "F3",
                status: "deferred",
                action: "later",
                rationale: "rationale C",
              },
            ],
            executionReport: { executionVersion: 5 },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("deferred")).toBeDefined();
    expect(screen.getByText("fixed it")).toBeDefined();
    expect(screen.getByText(/v/).textContent).toContain("5");
  });

  it("defaults remediation's referenced execution version to 2 when executionReport is absent", () => {
    render(
      <ArtifactTabs
        artifacts={[makeArtifact("Remediation", { resolution: [] })]}
      />,
    );
    expect(screen.getByText(/v/, { selector: "p" }).textContent).toContain("2");
  });

  it("renders multiple RejectionContext artifacts sorted descending by version", async () => {
    render(
      <ArtifactTabs
        artifacts={[
          makeArtifact(
            "RejectionContext",
            { planVersion: 1, feedback: "first rejection", source: "api" },
            { id: "rc1", version: 1 },
          ),
          makeArtifact(
            "RejectionContext",
            { planVersion: 2, feedback: "second rejection", source: "linear" },
            { id: "rc2", version: 2 },
          ),
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Rejection Feedback" }),
    );

    const feedbackTexts = screen
      .getAllByText(/rejection$/)
      .map((el) => el.textContent);
    expect(feedbackTexts).toEqual(["second rejection", "first rejection"]);
    expect(screen.getByText("Plan V2 Rejection")).toBeDefined();
    expect(screen.getByText("Plan V1 Rejection")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
  });

  it("falls back to 'No data available' when the active tab's artifact disappears after a prop update", () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "plan body" }),
          makeArtifact("ExecutionReport", { summary: "exec body" }),
        ]}
      />,
    );
    // Plan is the default (first available) active tab.
    expect(screen.getByText("plan body")).toBeDefined();

    // Re-render with the Plan artifact removed but another artifact kept,
    // so availableTabs stays non-empty while the active tab's data vanishes.
    rerender(
      <ArtifactTabs
        artifacts={[makeArtifact("ExecutionReport", { summary: "exec body" })]}
      />,
    );

    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("falls back to 'No rejection feedback recorded' when rejection artifacts disappear after a prop update", async () => {
    const { rerender } = render(
      <ArtifactTabs
        artifacts={[
          makeArtifact("Plan", { summary: "plan body" }),
          makeArtifact("RejectionContext", {
            planVersion: 1,
            feedback: "feedback text",
            source: "api",
          }),
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Rejection Feedback" }),
    );
    expect(screen.getByText("feedback text")).toBeDefined();

    rerender(
      <ArtifactTabs artifacts={[makeArtifact("Plan", { summary: "plan body" })]} />,
    );

    expect(screen.getByText("No rejection feedback recorded")).toBeDefined();
  });
});
