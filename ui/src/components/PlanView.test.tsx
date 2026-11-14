import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders a minimal plan without optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders version and confidence with the done color above 0.7", () => {
    const { container } = render(<PlanView plan={{ planVersion: 3, confidence: 0.85 }} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("colors the confidence bar as waiting between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the confidence bar as blocked below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary and requirements traceability as markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Do the thing", requirementsTraceability: "Covers req #1" }}
      />,
    );
    expect(screen.getByText("Do the thing")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers req #1")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do A" },
            { id: "s2", title: "Step two", description: "Do B" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{ assumptions: ["API is stable"], risks: ["Migration could fail"] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("API is stable")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could fail")).toBeDefined();
  });

  it("renders open questions, flagging ones that block execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which DB?", requiredForExecution: true },
            { id: "q2", question: "Naming convention?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which DB?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    expect(screen.getByText("Naming convention?")).toBeDefined();
  });
});
