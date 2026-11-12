import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

describe("ExecutionReportView", () => {
  it("renders the default version when executionVersion is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom execution version, score, and score rationale", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          executionVersion: 3,
          score: 0.85,
          scoreRationale: "Most checks pass with minor issues.",
        }}
      />,
    );
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Most checks pass with minor issues.")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("colors the score bar as waiting for mid-range scores", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar as blocked for low scores", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score bar or rationale when score is missing", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphaned" }} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
    expect(screen.queryByText("orphaned")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing." }} />);
    expect(screen.getByText("Did the thing.")).toBeDefined();
  });

  it("renders pass, fail, and skip checks with their details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues found" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skip", details: "Skipped by config" },
          },
        }}
      />,
    );

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues found")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("Skipped by config")).toBeDefined();
  });

  it("does not render the checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with a count", () => {
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
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
  });

  it("renders notes as a markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["First note", "Second note"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second note")).toBeDefined();
  });

  it("does not render the notes section when the list is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });

  it("omits the PR draft row entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
