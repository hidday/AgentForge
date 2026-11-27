import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

const richReport: Record<string, unknown> = {
  executionVersion: 2,
  score: 0.85,
  scoreRationale: "Most checks passed cleanly.",
  summary: "Execution summary text.",
  checks: {
    lint: { status: "pass", details: "No lint errors." },
    typecheck: { status: "fail", details: "2 type errors." },
    tests: { status: "skipped", details: "Not run." },
  },
  filesChanged: ["src/a.ts", "src/b.ts"],
  notes: ["Note one", "Note two"],
  prDraftCreated: true,
};

describe("ExecutionReportView", () => {
  it("renders all sections for a rich payload", () => {
    render(<ExecutionReportView report={richReport} />);

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Most checks passed cleanly.")).toBeDefined();
    expect(screen.getByText("Execution summary text.")).toBeDefined();

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No lint errors.")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 type errors.")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("Not run.")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();

    const prLine = screen.getByText(/PR Draft:/);
    expect(prLine.textContent).toContain("Created");
  });

  it("defaults executionVersion to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("colors the score bar green and uses done styling for score >= 0.7", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(document.querySelector(".bg-state-done")).not.toBeNull();
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("colors the score bar yellow for score between 0.4 and 0.69", () => {
    render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();
    expect(document.querySelector(".bg-state-done")).toBeNull();
  });

  it("colors the score bar red for score below 0.4", () => {
    render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
    expect(document.querySelector(".bg-state-done")).toBeNull();
    expect(document.querySelector(".bg-state-waiting")).toBeNull();
  });

  it("does not render the score rationale line when score is absent even if rationale is present", () => {
    render(
      <ExecutionReportView
        report={{ scoreRationale: "Should not show without score" }}
      />,
    );
    expect(screen.queryByText("Should not show without score")).toBeNull();
  });

  it("applies pass styling and icon semantics for a passing check", () => {
    render(
      <ExecutionReportView
        report={{ checks: { build: { status: "pass", details: "ok" } } }}
      />,
    );
    const label = screen.getByText("build");
    const card = label.closest("div.rounded");
    expect(card?.className).toContain("border-state-done/30");
  });

  it("applies fail styling for a failing check", () => {
    render(
      <ExecutionReportView
        report={{ checks: { build: { status: "fail", details: "broken" } } }}
      />,
    );
    const label = screen.getByText("build");
    const card = label.closest("div.rounded");
    expect(card?.className).toContain("border-state-blocked/30");
  });

  it("applies neutral styling for a check with an unknown status", () => {
    render(
      <ExecutionReportView
        report={{ checks: { build: { status: "skipped", details: "n/a" } } }}
      />,
    );
    const label = screen.getByText("build");
    const card = label.closest("div.rounded");
    expect(card?.className).not.toContain("border-state-done/30");
    expect(card?.className).not.toContain("border-state-blocked/30");
    expect(card?.className).toContain("border-border-subtle");
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    const prLine = screen.getByText(/PR Draft:/);
    expect(prLine.textContent).toContain("Not created");
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a minimal/empty payload without optional sections", () => {
    const { container } = render(<ExecutionReportView report={{}} />);

    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(container.querySelector(".bg-border")).toBeNull();
    expect(container.firstChild).not.toBeNull();
  });

  it("treats empty filesChanged/notes arrays and null checks as absent sections", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: [], notes: [], checks: null }}
      />,
    );
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
  });
});
