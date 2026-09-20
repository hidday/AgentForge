import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

const fullPlan = {
  planVersion: 3,
  confidence: 0.85,
  summary: "This plan does X.",
  requirementsTraceability: "Covers REQ-1 and REQ-2.",
  steps: [
    { id: "s1", title: "Step One", description: "Do the first thing." },
    { id: "s2", title: "Step Two", description: "Do the second thing." },
  ],
  assumptions: ["Assumption A", "Assumption B"],
  risks: ["Risk A"],
  openQuestions: [
    { id: "q1", question: "Is this ok?", requiredForExecution: true },
    { id: "q2", question: "Any concerns?", requiredForExecution: false },
  ],
};

describe("PlanView", () => {
  it("renders all sections of a populated plan with correct order and content", () => {
    render(<PlanView plan={fullPlan} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();

    expect(screen.getByText("This plan does X.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();

    expect(screen.getByText("Steps")).toBeDefined();
    const stepTitles = screen.getAllByText(/^Step (One|Two)$/);
    expect(stepTitles.map((el) => el.textContent)).toEqual([
      "Step One",
      "Step Two",
    ]);
    expect(screen.getByText("Do the first thing.")).toBeDefined();
    expect(screen.getByText("Do the second thing.")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();

    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Is this ok?")).toBeDefined();
    expect(screen.getByText("Any concerns?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("renders a confidence bar tinted by risk level", () => {
    const { container, rerender } = render(
      <PlanView plan={{ confidence: 0.9 }} />,
    );
    expect(container.querySelector(".bg-state-done")).not.toBeNull();

    rerender(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();

    rerender(<PlanView plan={{ confidence: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders no optional sections and no crash for an empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);

    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("only flags required open questions as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            {
              id: "q1",
              question: "Optional question?",
              requiredForExecution: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
