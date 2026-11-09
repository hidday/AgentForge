import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the execution version, defaulting to v1 when not provided", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render the score bar or rationale when score is absent", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("renders a high score with the done color band and percentage, and the rationale", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.85, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("renders a mid-range score (waiting band) without crashing the color logic", () => {
    render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
  });

  it("renders a low score (blocked band)", () => {
    render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
  });

  it("renders the score bar without rationale when scoreRationale is absent", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(
      <ExecutionReportView
        report={{ summary: "## Summary\n\nDid the thing." }}
      />,
    );
    expect(screen.getByText("Summary")).toBeDefined();
    expect(screen.getByText("Did the thing.")).toBeDefined();
  });

  it("does not render a summary section when absent", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(container.querySelector("h1, h2, h3")).toBeNull();
  });

  it("renders checks with pass, fail, and other statuses with distinct styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues" },
            typecheck: { status: "fail", details: "2 errors" },
            format: { status: "skipped", details: "Not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("format")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();
  });

  it("does not render the checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts", "src/c.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (3)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
    expect(screen.getByText("src/c.ts")).toBeDefined();
  });

  it("does not render the files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a markdown list", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second **bold** note"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("bold")).toBeDefined();
  });

  it("does not render the notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    const row = screen.getByText(/PR Draft:/);
    expect(row.textContent).toBe("PR Draft: Created");
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    const row = screen.getByText(/PR Draft:/);
    expect(row.textContent).toBe("PR Draft: Not created");
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report with all sections together", () => {
    render(
      <ExecutionReportView
        report={{
          summary: "Implemented the feature.",
          filesChanged: ["src/foo.ts"],
          checks: { tests: { status: "pass", details: "12/12" } },
          notes: ["Remember to update docs"],
          prDraftCreated: true,
          executionVersion: 2,
          score: 0.75,
          scoreRationale: "Solid implementation",
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("Solid implementation")).toBeDefined();
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText(/PR Draft:/).textContent).toBe("PR Draft: Created");
  });
});
