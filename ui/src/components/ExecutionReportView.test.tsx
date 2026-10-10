import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders a minimal report with version defaulting to 1 and no optional sections", () => {
    const { container } = render(<ExecutionReportView report={{}} />);

    expect(screen.getByText("v1")).toBeDefined();
    expect(container.querySelector(".h-full.rounded-full")).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/^PR Draft:/)).toBeNull();
  });

  it("renders a full report with high score (>=0.7 band), checks, files, notes and prDraftCreated=true", () => {
    const report = {
      executionVersion: 4,
      score: 0.85,
      scoreRationale: "All checks passed cleanly.",
      summary: "## Summary\nImplemented the feature.",
      checks: {
        lint: { status: "pass", details: "0 problems" },
        tests: { status: "fail", details: "2 failed" },
        typecheck: { status: "skipped", details: "not run" },
      },
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["First note", "Second note"],
      prDraftCreated: true,
    };

    const { container } = render(<ExecutionReportView report={report} />);

    expect(screen.getByText("v4")).toBeDefined();
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-done");
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
    expect(screen.getByText("Implemented the feature.")).toBeDefined();

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failed")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second note")).toBeDefined();

    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it("colors the score bar for the middle band (>=0.4 and <0.7)", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.5 }} />,
    );
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-waiting");
    expect(screen.getByText("Score: 50%")).toBeDefined();
  });

  it("colors the score bar for the low band (<0.4)", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.1 }} />,
    );
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-blocked");
    expect(screen.getByText("Score: 10%")).toBeDefined();
  });

  it("omits the score rationale when there is no score, even if rationale text exists", () => {
    render(
      <ExecutionReportView
        report={{ scoreRationale: "Should not show without a score." }}
      />,
    );
    expect(
      screen.queryByText("Should not show without a score."),
    ).toBeNull();
  });

  it("shows the score bar without a rationale when scoreRationale is absent", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(container.querySelector(".h-full.rounded-full")).toBeDefined();
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("renders prDraftCreated=false explicitly as Not created", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("applies pass/fail/other icon styling per check status", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            a: { status: "pass", details: "ok" },
            b: { status: "fail", details: "bad" },
            c: { status: "other", details: "meh" },
          },
        }}
      />,
    );

    const cards = container.querySelectorAll(".grid-cols-3 > div");
    expect(cards.length).toBe(3);
    expect(cards[0].className).toContain("border-state-done/30");
    expect(cards[1].className).toContain("border-state-blocked/30");
    expect(cards[2].className).toContain("border-border-subtle");
  });
});
