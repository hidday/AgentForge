import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version badge when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a provided executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("does not render a score bar when score is absent", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
  });

  it("renders the score bar and percentage, colored green at high score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe("90%");
  });

  it("colors the score bar amber for medium score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar red for low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the score rationale only alongside a score", () => {
    const { rerender } = render(
      <ExecutionReportView report={{ score: 0.8, scoreRationale: "Solid coverage" }} />,
    );
    expect(screen.getByText("Solid coverage")).toBeDefined();

    rerender(<ExecutionReportView report={{ scoreRationale: "Solid coverage" }} />);
    expect(screen.queryByText("Solid coverage")).toBeNull();
  });

  it("renders the summary as markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "Did the **thing**" }} />);
    expect(screen.getByText("thing")).toBeDefined();
  });

  it("does not render a summary section when absent", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(container.querySelector("h4")).toBeNull();
  });

  it("renders checks with pass/fail/other status icons and styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skip", details: "n/a" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle")).not.toBeNull();
  });

  it("does not render a checks section when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with a count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
  });

  it("renders notes as markdown bullet items", () => {
    render(<ExecutionReportView report={{ notes: ["First note", "Second **note**"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("note")).toBeDefined();
  });

  it("does not render a notes section when the list is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders 'Created' for a true prDraftCreated flag", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it("renders 'Not created' for a false prDraftCreated flag", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^PR Draft:/)).toBeNull();
  });
});
