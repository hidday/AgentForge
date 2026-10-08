import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

let n = 0;
function art(type: string, payloadJson: unknown, version = 1): Artifact {
  n += 1;
  return {
    id: `a${n}`,
    runId: "r1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: new Date().toISOString(),
  };
}

function tabNames() {
  return screen.getAllByRole("button").map((b) => b.textContent);
}

describe("ArtifactTabs", () => {
  it("shows an empty state when no known artifacts exist", () => {
    render(<ArtifactTabs artifacts={[art("Unknown", {})]} />);
    expect(screen.getByText(/No artifacts yet/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("only shows tabs for available artifact types, in canonical order, selecting the first", () => {
    render(
      <ArtifactTabs
        artifacts={[
          art("Review", { overallVerdict: "approved" }),
          art("Plan", { summary: "The plan summary" }),
        ]}
      />,
    );
    expect(tabNames()).toEqual(["Plan", "Code Review"]);
    expect(screen.getByRole("button", { name: "Plan" }).className).toContain("bg-accent");
    expect(screen.getByText("The plan summary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Code Review" }));
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan" }).className).not.toContain("bg-accent");
  });

  it("renders plan review and execution report tabs", () => {
    render(
      <ArtifactTabs
        artifacts={[
          art("PlanReview", { overallVerdict: "changes_requested", summary: "Needs work" }),
          art("ExecutionReport", { executionVersion: 4, summary: "Built it" }),
        ]}
      />,
    );
    expect(screen.getByText("Changes Requested")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.getByText("Built it")).toBeTruthy();
  });

  it("renders plan revision dispositions with status styles", () => {
    render(
      <ArtifactTabs
        artifacts={[
          art("PlanRevision", {
            dispositions: [
              { findingId: "F1", status: "accepted", rationale: "ok" },
              { findingId: "F2", status: "dismissed", rationale: "no" },
              { findingId: "F3", status: "partially_incorporated", rationale: "some" },
              { findingId: "F4", status: "other", rationale: "?" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Review Finding Dispositions")).toBeTruthy();
    expect(screen.getByText("accepted").className).toContain("text-state-done");
    expect(screen.getByText("dismissed").className).toContain("text-state-blocked");
    expect(screen.getByText("partially incorporated").className).toContain("text-state-waiting");
    expect(screen.getByText("other").className).toContain("text-text-muted");
  });

  it("shows an empty dispositions message", () => {
    render(<ArtifactTabs artifacts={[art("PlanRevision", {})]} />);
    expect(screen.getByText("No dispositions recorded")).toBeTruthy();
  });

  it("renders remediation resolutions and the referenced execution version", () => {
    render(
      <ArtifactTabs
        artifacts={[
          art("Remediation", {
            resolution: [
              { findingId: "R1", status: "accepted", action: "Fixed", rationale: "valid" },
              { findingId: "R2", status: "rejected", action: "Skipped", rationale: "invalid" },
              { findingId: "R3", status: "deferred", action: "Later", rationale: "scope" },
            ],
            executionReport: { executionVersion: 5 },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Resolutions")).toBeTruthy();
    expect(screen.getByText("accepted").className).toContain("text-state-done");
    expect(screen.getByText("rejected").className).toContain("text-state-blocked");
    expect(screen.getByText("deferred").className).toContain("text-state-waiting");
    expect(screen.getByText("Fixed")).toBeTruthy();
    expect(screen.getByText("invalid")).toBeTruthy();
    expect(screen.getByText(/open it to see the v\s*5/)).toBeTruthy();
  });

  it("defaults remediation execution version to 2", () => {
    render(<ArtifactTabs artifacts={[art("Remediation", {})]} />);
    expect(screen.getByText(/open it to see the v\s*2/)).toBeTruthy();
  });

  it("lists rejection feedback newest version first", () => {
    render(
      <ArtifactTabs
        artifacts={[
          art("RejectionContext", { planVersion: 1, feedback: "first rejection", source: "api" }, 1),
          art("RejectionContext", { planVersion: 2, feedback: "second rejection", source: "linear" }, 2),
        ]}
      />,
    );
    const headings = screen.getAllByText(/Plan V\d Rejection/).map((e) => e.textContent);
    expect(headings).toEqual(["Plan V2 Rejection", "Plan V1 Rejection"]);
    expect(screen.getByText("linear")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
    expect(screen.getByText("second rejection")).toBeTruthy();
  });
});
