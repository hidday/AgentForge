import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".space-y-5")).not.toBeNull();
    expect(screen.queryByText(/Steps/)).toBeNull();
    expect(screen.queryByText(/Assumptions/)).toBeNull();
    expect(screen.queryByText(/Risks/)).toBeNull();
    expect(screen.queryByText(/Open Questions/)).toBeNull();
  });

  it("renders version and a high-confidence bar (>= 0.7)", () => {
    render(<PlanView plan={{ planVersion: 3, confidence: 0.9 }} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
  });

  it("renders a medium-confidence bar (>= 0.4 and < 0.7)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders a low-confidence bar (< 0.4)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
    expect(screen.getByText("10%")).toBeDefined();
  });

  it("renders the summary and requirements traceability via Markdown", () => {
    render(
      <PlanView
        plan={{
          summary: "This is the summary",
          requirementsTraceability: "Traces to REQ-1",
        }}
      />,
    );
    expect(screen.getByText("This is the summary")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Traces to REQ-1")).toBeDefined();
  });

  it("renders steps with their index and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Do the thing", description: "First step details" },
            { id: "s2", title: "Do another thing", description: "Second step details" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Do the thing")).toBeDefined();
    expect(screen.getByText("Second step details")).toBeDefined();
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

  it("renders open questions and flags ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Blocking question?", requiredForExecution: true },
            { id: "q2", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Blocking question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
