import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock Markdown so we can assert on exactly what content it was given,
// without depending on react-markdown's rendering details.
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView – version header", () => {
  it("defaults to v1 when executionVersion is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("shows the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });
});

describe("ExecutionReportView – score bar", () => {
  it("does not render a score bar when score is missing", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
  });

  it("renders a high score (>= 0.7) with the 'done' bar color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.getByText("Score: 80%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe("80%");
  });

  it("renders a mid score (>= 0.4 and < 0.7) with the 'waiting' bar color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low score (< 0.4) with the 'blocked' bar color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders score 0 as the 'blocked' color (falsy but not null)", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0 }} />);
    expect(screen.getByText("Score: 0%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the score rationale alongside a present score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly" }}
      />,
    );
    expect(screen.getByText("All checks passed cleanly")).toBeDefined();
  });

  it("does not show a rationale when score is missing, even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Orphaned rationale" }} />);
    expect(screen.queryByText("Orphaned rationale")).toBeNull();
  });
});

describe("ExecutionReportView – summary", () => {
  it("renders the summary through Markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "## Done\nAll good" }} />);
    const md = screen.getByTestId("markdown-content");
    expect(md.textContent).toBe("## Done\nAll good");
  });

  it("renders no Markdown content when summary and notes are both absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryAllByTestId("markdown-content")).toHaveLength(0);
  });
});

describe("ExecutionReportView – checks", () => {
  it("does not render a Checks section when checks is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders a passing check with its name and details", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { lint: { status: "pass", details: "0 errors" } } }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
  });

  it("renders a failing check with blocked styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { tests: { status: "fail", details: "2 failed" } } }}
      />,
    );
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failed")).toBeDefined();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
  });

  it("renders a check with an unrecognised status using the neutral/skip styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { typecheck: { status: "skipped", details: "n/a" } } }}
      />,
    );
    expect(screen.getByText("typecheck")).toBeDefined();
    const neutral = container.querySelector(".border-border-subtle");
    expect(neutral).not.toBeNull();
  });

  it("renders multiple checks", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "clean" },
            tests: { status: "fail", details: "boom" },
            typecheck: { status: "skipped", details: "n/a" },
          },
        }}
      />,
    );
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
  });
});

describe("ExecutionReportView – files changed", () => {
  it("does not render a Files Changed section when filesChanged is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("does not render a Files Changed section when filesChanged is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders the file count and each file path", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });
});

describe("ExecutionReportView – notes", () => {
  it("does not render a Notes section when notes is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("does not render a Notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders each note through Markdown", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second note"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    const notes = screen.getAllByTestId("markdown-content");
    expect(notes.map((n) => n.textContent)).toEqual(["First note", "Second note"]);
  });
});

describe("ExecutionReportView – PR draft status", () => {
  it("does not render a PR Draft line when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("shows 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });
});

describe("ExecutionReportView – full report", () => {
  it("renders every section together from a complete report", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.85,
          scoreRationale: "Strong result",
          summary: "Implemented the feature",
          checks: { lint: { status: "pass", details: "clean" } },
          filesChanged: ["src/index.ts"],
          notes: ["Watch out for X"],
          prDraftCreated: true,
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Strong result")).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("src/index.ts")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();

    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.map((n) => n.textContent)).toEqual([
      "Implemented the feature",
      "Watch out for X",
    ]);
  });
});
