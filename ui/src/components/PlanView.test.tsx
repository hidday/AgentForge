import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan (no optional sections)", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
  });

  it("renders the version badge and a full plan with all sections", () => {
    const plan = {
      planVersion: 3,
      confidence: 0.85,
      summary: "This plan does X.",
      requirementsTraceability: "Covers REQ-1, REQ-2.",
      steps: [
        { id: "s1", title: "Step one", description: "Do the first thing." },
        { id: "s2", title: "Step two", description: "Do the second thing." },
      ],
      assumptions: ["Assumption A", "Assumption B"],
      risks: ["Risk A"],
      openQuestions: [
        { id: "q1", question: "What about X?", requiredForExecution: true },
        { id: "q2", question: "What about Y?", requiredForExecution: false },
      ],
    };
    const { container } = render(<PlanView plan={plan} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();

    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();

    const markdownBlocks = screen.getAllByTestId("markdown");
    // summary + traceability + 2 steps + 2 assumptions + 1 risk + 2 questions
    expect(markdownBlocks.length).toBe(9);
  });

  it("colors the confidence bar by threshold: medium (0.4-0.7) uses the waiting color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the confidence bar by threshold: low (<0.4) uses the blocked color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the confidence bar when confidence is absent", () => {
    const { container } = render(<PlanView plan={{ summary: "hi" }} />);
    expect(container.querySelector(".h-1\\.5.w-24")).toBeNull();
  });

  it("does not mark optional open questions as blocking execution", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Optional one?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.queryByText("blocks execution")).toBeNull();
    expect(screen.getByText("Optional one?")).toBeDefined();
  });

  it("renders only the sections present in a partial plan", () => {
    render(
      <PlanView
        plan={{ assumptions: ["Only an assumption"], risks: [] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
  });
});
