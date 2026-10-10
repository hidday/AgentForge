import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders an empty plan with none of the optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".h-1\\.5.w-24")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a full plan with high confidence (>=0.7 band)", () => {
    const plan = {
      planVersion: 3,
      confidence: 0.9,
      summary: "This plan adds a widget.",
      requirementsTraceability: "Covers REQ-1 and REQ-2.",
      steps: [
        { id: "s1", title: "Add widget", description: "Create the widget component." },
        { id: "s2", title: "Wire it up", description: "Hook into the store." },
      ],
      assumptions: ["The store already exists."],
      risks: ["Might break existing tests."],
      openQuestions: [
        { id: "q1", question: "Should this be feature-flagged?", requiredForExecution: true },
        { id: "q2", question: "Any design preference?", requiredForExecution: false },
      ],
    };

    const { container } = render(<PlanView plan={plan} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-done");
    expect((bar as HTMLElement).style.width).toBe("90%");

    expect(screen.getByText("This plan adds a widget.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Add widget")).toBeDefined();
    expect(screen.getByText("Wire it up")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("The store already exists.")).toBeDefined();

    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Might break existing tests.")).toBeDefined();

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Should this be feature-flagged?")).toBeDefined();
    expect(screen.getByText("Any design preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("colors the confidence bar for the middle band (>=0.4 and <0.7)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-waiting");
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("colors the confidence bar for the low band (<0.4)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-blocked");
    expect(screen.getByText("10%")).toBeDefined();
  });

  it("does not render the 'blocks execution' badge for optional questions only", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Optional only?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);

    expect(screen.getByText("Optional only?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
