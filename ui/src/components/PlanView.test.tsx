import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

const fullPlan = {
  planVersion: 3,
  confidence: 0.8,
  summary: "This plan implements the requested feature.",
  requirementsTraceability: "Covers issue AC 1 and AC 2.",
  steps: [
    { id: "s1", title: "Set up scaffolding", description: "Create base files." },
    { id: "s2", title: "Implement logic", description: "Write the core logic." },
  ],
  assumptions: ["The API is stable"],
  risks: ["Might break backwards compatibility"],
  openQuestions: [
    { id: "q1", question: "Should we support v1 clients?", requiredForExecution: true },
    { id: "q2", question: "Any style preference?", requiredForExecution: false },
  ],
};

describe("PlanView", () => {
  it("renders all plan sections when fully populated", () => {
    render(<PlanView plan={fullPlan} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("This plan implements the requested feature.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers issue AC 1 and AC 2.")).toBeDefined();

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up scaffolding")).toBeDefined();
    expect(screen.getByText("Create base files.")).toBeDefined();
    expect(screen.getByText("Implement logic")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("The API is stable")).toBeDefined();

    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Might break backwards compatibility")).toBeDefined();

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Should we support v1 clients?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    expect(screen.getByText("Any style preference?")).toBeDefined();
  });

  it("does not render optional sections when assumptions/risks/openQuestions are empty arrays", () => {
    const plan = {
      ...fullPlan,
      assumptions: [],
      risks: [],
      openQuestions: [],
    };
    render(<PlanView plan={plan} />);

    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    // Steps section should still render
    expect(screen.getByText("Steps")).toBeDefined();
  });

  it("renders without a version badge or confidence bar when absent", () => {
    render(<PlanView plan={{ summary: "Just a summary" }} />);
    expect(screen.getByText("Just a summary")).toBeDefined();
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("does not mark an open question as blocking when requiredForExecution is false", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
