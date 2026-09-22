import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders only the (empty) header when the plan has no fields set", () => {
    const { container } = render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    // still renders the outer wrapper without crashing
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders the version and a confidence bar sized/colored by confidence >= 0.7", () => {
    render(<PlanView plan={{ planVersion: 3, confidence: 0.9 }} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    const fill = document.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe("90%");
  });

  it("colors the confidence bar as waiting for mid-range confidence", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);

    expect(screen.getByText("50%")).toBeDefined();
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the confidence bar as blocked for low confidence", () => {
    render(<PlanView plan={{ confidence: 0.1 }} />);

    expect(screen.getByText("10%")).toBeDefined();
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders summary and requirements traceability as markdown", () => {
    render(
      <PlanView
        plan={{
          summary: "This plan adds a new endpoint.",
          requirementsTraceability: "Covers REQ-1 and REQ-2.",
        }}
      />,
    );

    expect(screen.getByText("This plan adds a new endpoint.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders steps in order with 1-based numbering", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "First step", description: "Do the first thing." },
            { id: "s2", title: "Second step", description: "Do the second thing." },
          ],
        }}
      />,
    );

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("First step")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Second step")).toBeDefined();
  });

  it("renders assumptions and risks as bulleted lists", () => {
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

  it("renders open questions and marks required-for-execution ones", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Should we support X?", requiredForExecution: true },
            { id: "q2", question: "Is Y needed?", requiredForExecution: false },
          ],
        }}
      />,
    );

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Should we support X?")).toBeDefined();
    expect(screen.getByText("Is Y needed?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();

    // only one question is marked as blocking
    expect(screen.getAllByText("blocks execution")).toHaveLength(1);
  });

  it("renders a full plan with every section present", () => {
    render(
      <PlanView
        plan={{
          planVersion: 1,
          confidence: 0.42,
          summary: "Full plan summary.",
          requirementsTraceability: "Traces REQ-9.",
          steps: [{ id: "s1", title: "Only step", description: "Do it." }],
          assumptions: ["An assumption"],
          risks: ["A risk"],
          openQuestions: [
            { id: "q1", question: "A question?", requiredForExecution: false },
          ],
        }}
      />,
    );

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.getByText("42%")).toBeDefined();
    expect(screen.getByText("Full plan summary.")).toBeDefined();
    expect(screen.getByText("Traces REQ-9.")).toBeDefined();
    expect(screen.getByText("Only step")).toBeDefined();
    expect(screen.getByText("An assumption")).toBeDefined();
    expect(screen.getByText("A risk")).toBeDefined();
    expect(screen.getByText("A question?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
