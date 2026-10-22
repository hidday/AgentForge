import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("defaults to version 1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the score percentage when score is present", () => {
    render(<ExecutionReportView report={{ score: 0.85 }} />);
    expect(screen.getByText("Score: 85%")).toBeDefined();
  });

  it("does not render a score rationale when score is absent even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Should not show" }} />);
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders score rationale text when both score and scoreRationale are present", () => {
    render(
      <ExecutionReportView report={{ score: 0.5, scoreRationale: "Partially complete" }} />,
    );
    expect(screen.getByText("Partially complete")).toBeDefined();
  });

  it("uses the low-score (blocked) bar color when score is below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the markdown summary through the Markdown component", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Did the thing.");
  });

  it("renders checks with pass/fail/pending icons and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 issues" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 issues")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("lists changed files when filesChanged is non-empty", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render a files-changed section when filesChanged is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    const notes = screen.getAllByTestId("markdown-content");
    expect(notes.map((n) => n.textContent)).toEqual(["Note one", "Note two"]);
  });

  it("shows 'Created' when prDraftCreated is true and 'Not created' when false", () => {
    const { rerender } = render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();

    rerender(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
