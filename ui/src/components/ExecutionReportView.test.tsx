import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults executionVersion to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the score bar and percentage when score is present", () => {
    render(<ExecutionReportView report={{ score: 0.75 }} />);
    expect(screen.getByText("Score: 75%")).toBeDefined();
  });

  it("colors the score bar green for a high score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("colors the score bar yellow for a medium score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar red for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders scoreRationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "Clean implementation." }}
      />,
    );
    expect(screen.getByText("Clean implementation.")).toBeDefined();
  });

  it("does not render scoreRationale when score is absent", () => {
    render(
      <ExecutionReportView report={{ scoreRationale: "Should not show." }} />,
    );
    expect(screen.queryByText("Should not show.")).toBeNull();
  });

  it("renders the summary via Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "Did the thing.",
    );
  });

  it("renders checks with pass/fail/other statuses and their details", () => {
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

  it("does not render the Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with its count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render the Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const markdowns = screen.getAllByTestId("markdown-content");
    expect(markdowns.map((m) => m.textContent)).toEqual(["Note one", "Note two"]);
  });

  it("shows 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/).textContent).toContain("Created");
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:/).textContent).toContain("Not created");
  });

  it("does not render the PR draft line when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
