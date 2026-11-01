import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the execution version, defaulting to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a provided execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("does not render a score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders the score percentage and rationale when present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.8, scoreRationale: "Most checks passed." }}
      />,
    );
    expect(screen.getByText("Score: 80%")).toBeDefined();
    expect(screen.getByText("Most checks passed.")).toBeDefined();
  });

  it("does not render rationale when score is present but rationale is absent", () => {
    render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.queryByText("Most checks passed.")).toBeNull();
  });

  it("colors the score bar done/waiting/blocked by threshold", () => {
    const { rerender } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(document.querySelector(".bg-state-done")).not.toBeNull();

    rerender(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();

    rerender(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Did the thing");
  });

  it("renders checks with pass/fail/other icons and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 errors" },
            typecheck: { status: "fail", details: "2 errors" },
            format: { status: "skipped", details: "n/a" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("format")).toBeDefined();
  });

  it("does not render the Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the list of files changed with a count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.map((el) => el.textContent)).toEqual(["Note one", "Note two"]);
  });

  it("does not render Notes section when notes is empty", () => {
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

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
