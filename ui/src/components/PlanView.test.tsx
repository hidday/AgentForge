import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing in optional sections when plan has no optional fields", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders version and summary when present", () => {
    render(<PlanView plan={{ planVersion: 3, summary: "Plan summary text" }} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Maps req A to step 1" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Maps req A to step 1")).toBeDefined();
  });

  it("renders steps in order with 1-based index", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "First step", description: "do thing one" },
            { id: "s2", title: "Second step", description: "do thing two" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("First step")).toBeDefined();
    expect(screen.getByText("Second step")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Assumption one", "Assumption two"],
          risks: ["Risk one"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption one")).toBeDefined();
    expect(screen.getByText("Assumption two")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk one")).toBeDefined();
  });

  it("renders open questions, marking ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Required question?", requiredForExecution: true },
            { id: "q2", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Required question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("renders confidence bar in state-done color and percentage for confidence >= 0.7", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders confidence bar in state-waiting color for confidence between 0.4 and 0.7", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders confidence bar in state-blocked color for confidence below 0.4", () => {
    render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
  });

  it("does not render confidence block when confidence is undefined", () => {
    render(<PlanView plan={{ summary: "just a summary" }} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
