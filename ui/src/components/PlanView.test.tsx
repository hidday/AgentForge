import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.2, "bg-state-blocked"],
  ])("colors the confidence bar for confidence=%s", (confidence, expectedClass) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar!.className).toContain(expectedClass);
  });

  it("does not render confidence when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "## Plan Summary" }} />);
    expect(screen.getByText("Plan Summary").tagName).toBe("H2");
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("does not render requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up schema", description: "Add the `User` table." },
            { id: "s2", title: "Write API", description: "Implement endpoints." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up schema")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("User")).toBeDefined(); // inline code from description markdown
  });

  it("does not render the steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView plan={{ assumptions: ["Node 22 is available", "CI is green"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("CI is green")).toBeDefined();
  });

  it("does not render assumptions when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks with warning styling", () => {
    render(<PlanView plan={{ risks: ["Migration could be slow"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could be slow")).toBeDefined();
  });

  it("does not render risks when empty", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions, flagging ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which auth method?", requiredForExecution: true },
            { id: "q2", question: "Preferred logging format?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which auth method?")).toBeDefined();
    expect(screen.getByText("Preferred logging format?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' for optional open questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional one?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Optional one?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("does not render the open questions section when empty", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
