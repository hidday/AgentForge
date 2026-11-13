import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("defaults to v1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("does not render a score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders a done-colored score bar and percentage for score >= 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-done");
  });

  it("renders a waiting-colored score bar for score between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-waiting");
  });

  it("renders a blocked-colored score bar for score below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-blocked");
  });

  it("renders scoreRationale only when score is also present", () => {
    const { rerender } = render(
      <ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />,
    );
    expect(screen.queryByText("orphan rationale")).toBeNull();

    rerender(
      <ExecutionReportView report={{ score: 0.6, scoreRationale: "solid rationale" }} />,
    );
    expect(screen.getByText("solid rationale")).toBeDefined();
  });

  it("renders the summary through Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "Implemented the feature.",
    );
  });

  it("renders checks with pass/fail/other icon styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            typecheck: { status: "fail", details: "3 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("3 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
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

  it("does not render the Files Changed section when empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const markdowns = screen.getAllByTestId("markdown-content");
    expect(markdowns.some((m) => m.textContent === "Note one")).toBe(true);
    expect(markdowns.some((m) => m.textContent === "Note two")).toBe(true);
  });

  it("does not render the Notes section when empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
