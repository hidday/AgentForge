import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults version to v1 and omits optional sections", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders a full report", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.9,
          scoreRationale: "All tests pass",
          summary: "Implemented feature",
          checks: {
            tests: { status: "pass", details: "42 passed" },
            lint: { status: "fail", details: "3 errors" },
            typecheck: { status: "skipped", details: "n/a" },
          },
          filesChanged: ["src/a.ts", "src/b.ts"],
          notes: ["Follow up later"],
          prDraftCreated: true,
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeTruthy();
    expect(screen.getByText("Score: 90%")).toBeTruthy();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
    expect(screen.getByText("All tests pass")).toBeTruthy();
    expect(screen.getByText("Implemented feature")).toBeTruthy();

    const passCard = screen.getByText("tests").parentElement!;
    expect(passCard.className).toContain("bg-state-done-bg");
    expect(screen.getByText("42 passed")).toBeTruthy();
    const failCard = screen.getByText("lint").parentElement!;
    expect(failCard.className).toContain("bg-state-blocked-bg");
    const otherCard = screen.getByText("typecheck").parentElement!;
    expect(otherCard.className).toContain("bg-surface");
    expect(otherCard.querySelector("svg")!.getAttribute("class")).toContain("text-text-muted");

    expect(screen.getByText("Files Changed (2)")).toBeTruthy();
    expect(screen.getByText("src/b.ts")).toBeTruthy();
    expect(screen.getByText("Follow up later")).toBeTruthy();
    expect(screen.getByText(/PR Draft: Created/)).toBeTruthy();
  });

  it("hides rationale without a score and reports PR not created", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan", prDraftCreated: false }} />);
    expect(screen.queryByText("orphan")).toBeNull();
    expect(screen.getByText(/PR Draft: Not created/)).toBeTruthy();
  });

  it.each([
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("colors score %s with %s", (score, cls) => {
    const { container } = render(<ExecutionReportView report={{ score }} />);
    expect((container.querySelector(`.${cls}`) as HTMLElement).style.width).toBe(`${score * 100}%`);
  });
});
