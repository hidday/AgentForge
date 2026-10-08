import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders no sections for an empty plan", () => {
    render(<PlanView plan={{}} />);
    for (const h of ["Steps", "Assumptions", "Risks", "Open Questions", "Requirements Traceability"]) {
      expect(screen.queryByText(h)).toBeNull();
    }
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders all sections of a populated plan", () => {
    render(
      <PlanView
        plan={{
          planVersion: 3,
          confidence: 0.85,
          summary: "Do **the thing**",
          requirementsTraceability: "R1 -> step 1",
          steps: [
            { id: "s1", title: "First", description: "desc one" },
            { id: "s2", title: "Second", description: "desc two" },
          ],
          assumptions: ["API is stable"],
          risks: ["Migration may fail"],
          openQuestions: [
            { id: "q1", question: "Which DB?", requiredForExecution: true },
            { id: "q2", question: "Color?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("the thing").tagName).toBe("STRONG");
    expect(screen.getByText("R1 -> step 1")).toBeTruthy();
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("desc two")).toBeTruthy();
    expect(screen.getByText("API is stable")).toBeTruthy();
    expect(screen.getByText("Migration may fail")).toBeTruthy();
    expect(screen.getByText("Which DB?")).toBeTruthy();
    expect(screen.getAllByText("blocks execution")).toHaveLength(1);
  });

  it.each([
    [0.7, "bg-state-done", "70%"],
    [0.4, "bg-state-waiting", "40%"],
    [0.39, "bg-state-blocked", "39%"],
  ])("colors confidence %s with %s", (confidence, cls, text) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    const bar = container.querySelector(`.${cls}`) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe(`${confidence * 100}%`);
    expect(screen.getByText(text)).toBeTruthy();
  });
});
