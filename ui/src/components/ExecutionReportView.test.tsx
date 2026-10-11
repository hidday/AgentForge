import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version (v1) when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the score bar and rationale when score is present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.85, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("does not render the score section when score is absent", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing" }} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("colors the score bar appropriately for score=%s", (score, expectedClass) => {
    const { container } = render(
      <ExecutionReportView report={{ score }} />,
    );
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain(expectedClass);
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "## Heading text" }} />);
    const heading = screen.getByText("Heading text");
    expect(heading.tagName).toBe("H2");
  });

  it("renders checks with pass, fail, and other statuses", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "Not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();
  });

  it("does not render the checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the list of files changed with a count", () => {
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

  it("does not render the files-changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a list of markdown items", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second **note**"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("note")).toBeDefined(); // bold part of second note
  });

  it("does not render the notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders PR draft created status", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("renders PR draft not-created status", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
