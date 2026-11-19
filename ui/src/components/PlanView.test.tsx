import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders the plan version when provided", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version label when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders a confidence bar and percentage when confidence is provided", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("uses the mid-range (waiting) confidence style between 0.4 and 0.7", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("uses the low (blocked) confidence style below 0.4", () => {
    render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This plan does X." }} />);
    expect(screen.getByText("This plan does X.")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1, REQ-2")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up schema", description: "Add migration" },
            { id: "s2", title: "Write handler", description: "Implement route" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up schema")).toBeDefined();
    expect(screen.getByText("Write handler")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("does not render a Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["API is stable"],
          risks: ["Migration could fail on large tables"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("API is stable")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could fail on large tables")).toBeDefined();
  });

  it("renders open questions and marks required-for-execution ones as blocking", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which auth provider?", requiredForExecution: true },
            { id: "q2", question: "Preferred color scheme?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which auth provider?")).toBeDefined();
    expect(screen.getByText("Preferred color scheme?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the 'blocks execution' tag for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional Q", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
