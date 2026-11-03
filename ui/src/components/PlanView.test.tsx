import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage with done styling at high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders waiting styling for mid confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders blocked styling for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "Do the thing" }} />);
    expect(screen.getByText("Do the thing")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers AC-1, AC-2" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers AC-1, AC-2")).toBeDefined();
  });

  it("renders steps with index numbering and title/description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do first thing" },
            { id: "s2", title: "Step two", description: "Do second thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
  });

  it("renders assumptions list", () => {
    render(<PlanView plan={{ assumptions: ["Assume X", "Assume Y"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assume X")).toBeDefined();
    expect(screen.getByText("Assume Y")).toBeDefined();
  });

  it("renders risks list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions with blocks-execution tag when required", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What env?", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What env?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the blocks-execution tag for a non-required question", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Nice to know?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Nice to know?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("omits sections whose arrays are empty", () => {
    render(<PlanView plan={{ steps: [], assumptions: [], risks: [], openQuestions: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("does not render the confidence bar when confidence is null/undefined", () => {
    const { container } = render(<PlanView plan={{ planVersion: 1 }} />);
    expect(container.querySelector(".bg-border")).toBeNull();
  });
});
