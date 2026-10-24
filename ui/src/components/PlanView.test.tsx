import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high confidence score with done styling", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain("state-done");
  });

  it("renders a mid confidence score with waiting styling", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain("state-waiting");
  });

  it("renders a low confidence score with blocked styling", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain("state-blocked");
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This plan does X." }} />);
    expect(screen.getByText("This plan does X.")).toBeDefined();
  });

  it("renders requirements traceability when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1." }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1.")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    const plan = {
      steps: [
        { id: "s1", title: "Add schema", description: "Update the DB schema." },
        { id: "s2", title: "Write tests", description: "Cover the new path." },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Add schema")).toBeDefined();
    expect(screen.getByText("Write tests")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions as a list", () => {
    render(<PlanView plan={{ assumptions: ["DB is Postgres", "Auth already works"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("DB is Postgres")).toBeDefined();
  });

  it("renders risks as a list", () => {
    render(<PlanView plan={{ risks: ["Migration could be slow"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could be slow")).toBeDefined();
  });

  it("renders open questions and marks the ones required for execution", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Which runtime?", requiredForExecution: true },
        { id: "q2", question: "Optional detail?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which runtime?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    expect(screen.getByText("Optional detail?")).toBeDefined();
  });

  it("does not render section headers for empty arrays", () => {
    render(<PlanView plan={{ steps: [], assumptions: [], risks: [], openQuestions: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
