import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults to v1 when executionVersion is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render the score bar or rationale when score is absent", () => {
    render(<ExecutionReportView report={{ scoreRationale: "irrelevant" }} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("irrelevant")).toBeNull();
  });

  it("renders a done-colored score bar and percentage for high scores", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.85, scoreRationale: "Looks solid" }} />,
    );
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Looks solid")).toBeDefined();
    const fill = container.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
  });

  it("renders a waiting-colored score bar for mid-range scores", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a blocked-colored score bar for low scores", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score rationale when score is present but rationale is absent", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("renders the summary through Markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "## Done" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("## Done");
  });

  it("omits the summary block entirely when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("renders pass/fail/other checks with the right status styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();

    const cards = container.querySelectorAll(".grid > div");
    expect(cards.length).toBe(3);
    const classNames = Array.from(cards).map((c) => c.className);
    expect(classNames.some((c) => c.includes("border-state-done/30"))).toBe(true);
    expect(classNames.some((c) => c.includes("border-state-blocked/30"))).toBe(true);
    expect(classNames.some((c) => c.includes("border-border-subtle"))).toBe(true);
  });

  it("omits the Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the Files Changed section with count and file list", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("omits the Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown and omits the section when empty", () => {
    const { rerender } = render(
      <ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.map((el) => el.textContent)).toEqual(["Note one", "Note two"]);

    rerender(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
