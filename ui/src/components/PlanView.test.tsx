import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing for version badge when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the plan version badge when present", () => {
    render(<PlanView plan={{ planVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("does not render the confidence bar when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders a high confidence (done band)", () => {
    render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(screen.getByText("90%")).toBeDefined();
  });

  it("renders a mid confidence (waiting band)", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders a low confidence (blocked band)", () => {
    render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "Plan **summary** text" }} />);
    expect(screen.getByText("summary")).toBeDefined();
  });

  it("does not render a summary block when absent", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.textContent).not.toContain("summary");
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2")).toBeDefined();
  });

  it("does not render requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders steps numbered with title and markdown description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up scaffolding", description: "Create base files." },
            { id: "s2", title: "Implement logic", description: "Write the **core** logic." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up scaffolding")).toBeDefined();
    expect(screen.getByText("Implement logic")).toBeDefined();
    expect(screen.getByText("core")).toBeDefined();
  });

  it("does not render the steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a markdown bullet list", () => {
    render(
      <PlanView
        plan={{ assumptions: ["Node 22 is available", "DB is already migrated"] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("DB is already migrated")).toBeDefined();
  });

  it("does not render assumptions section when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks as a markdown bullet list", () => {
    render(
      <PlanView plan={{ risks: ["Migration could fail", "Rate limits"] }} />,
    );
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could fail")).toBeDefined();
    expect(screen.getByText("Rate limits")).toBeDefined();
  });

  it("does not render risks section when empty", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions, flagging ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which database?", requiredForExecution: true },
            { id: "q2", question: "Which color scheme?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which database?")).toBeDefined();
    expect(screen.getByText("Which color scheme?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render the 'blocks execution' tag for non-required questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Optional question")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("does not render open questions section when empty", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a fully populated plan with all sections together", () => {
    render(
      <PlanView
        plan={{
          planVersion: 1,
          confidence: 0.8,
          summary: "Overall plan summary",
          requirementsTraceability: "Maps to REQ-9",
          steps: [{ id: "s1", title: "Step one", description: "Do it." }],
          assumptions: ["An assumption"],
          risks: ["A risk"],
          openQuestions: [
            { id: "q1", question: "A question", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Overall plan summary")).toBeDefined();
    expect(screen.getByText("Maps to REQ-9")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("An assumption")).toBeDefined();
    expect(screen.getByText("A risk")).toBeDefined();
    expect(screen.getByText("A question")).toBeDefined();
  });
});
