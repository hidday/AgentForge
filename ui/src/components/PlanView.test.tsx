import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing crash-worthy for a bare empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version tag when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("colors the confidence bar appropriately for confidence=%s", (confidence, expectedClass) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    const bar = container.querySelector(`.${expectedClass}`);
    expect(bar).not.toBeNull();
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
  });

  it("does not render a confidence bar when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This is the **summary**." }} />);
    expect(screen.getByText("summary", { exact: false })).toBeDefined();
  });

  it("renders requirements traceability when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers req-1 and req-2." }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers req-1 and req-2.")).toBeDefined();
  });

  it("does not render the requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders steps with index numbers, titles, and descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up DB", description: "Create the schema." },
            { id: "s2", title: "Write API", description: "Add endpoints." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up DB")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("does not render a Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a list", () => {
    render(<PlanView plan={{ assumptions: ["Assumes Node 22", "Assumes pnpm"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumes Node 22")).toBeDefined();
    expect(screen.getByText("Assumes pnpm")).toBeDefined();
  });

  it("renders risks as a list", () => {
    render(<PlanView plan={{ risks: ["Could break prod"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Could break prod")).toBeDefined();
  });

  it("renders open questions, marking required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What env?", requiredForExecution: true },
            { id: "q2", question: "Any limits?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What env?")).toBeDefined();
    expect(screen.getByText("Any limits?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' badge for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
