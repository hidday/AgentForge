import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

const fullPlan = {
  planVersion: 3,
  confidence: 0.85,
  summary: "This plan adds a new endpoint.",
  requirementsTraceability: "Covers REQ-1 and REQ-2.",
  steps: [
    { id: "s1", title: "Add route", description: "Wire up the new route." },
    { id: "s2", title: "Add tests", description: "Cover the happy path." },
  ],
  assumptions: ["The database schema is unchanged."],
  risks: ["Could break backward compatibility."],
  openQuestions: [
    { id: "q1", question: "Which auth scheme?", requiredForExecution: true },
    { id: "q2", question: "Any rate limiting?", requiredForExecution: false },
  ],
};

describe("PlanView", () => {
  it("renders the version, confidence percentage, summary and traceability", () => {
    render(<PlanView plan={fullPlan} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(screen.getByText("This plan adds a new endpoint.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders each step with its 1-based index, title and description", () => {
    render(<PlanView plan={fullPlan} />);
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Add route")).toBeDefined();
    expect(screen.getByText("Wire up the new route.")).toBeDefined();
    expect(screen.getByText("Add tests")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(<PlanView plan={fullPlan} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("The database schema is unchanged.")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Could break backward compatibility.")).toBeDefined();
  });

  it("renders open questions, marking only the required one as blocking execution", () => {
    render(<PlanView plan={fullPlan} />);
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which auth scheme?")).toBeDefined();
    expect(screen.getByText("Any rate limiting?")).toBeDefined();
    const blockers = screen.getAllByText("blocks execution");
    expect(blockers).toHaveLength(1);
  });

  it("uses done styling for confidence >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("uses waiting styling for confidence between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("uses blocked styling for confidence below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders gracefully with an empty plan, omitting all optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".bg-state-done, .bg-state-waiting, .bg-state-blocked")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
