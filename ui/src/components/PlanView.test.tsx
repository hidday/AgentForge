import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a minimal/empty plan (no optional sections shown)", () => {
    const { container } = render(<PlanView plan={{}} />);
    // Header row always renders (even if empty), but none of the optional sections do
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("does not render the version label when planVersion is missing", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render the confidence bar when confidence is missing", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".tabular-nums")).toBeNull();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("renders confidence %s with the correct color class", (confidence, expectedClass) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
    const bar = container.querySelector(`.${expectedClass}`);
    expect(bar).not.toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<PlanView plan={{ summary: "This is the plan summary" }} />);
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "This is the plan summary")).toBe(
      true,
    );
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers requirement R1 and R2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "Covers requirement R1 and R2"),
    ).toBe(true);
  });

  it("renders steps in order with numbering, title, and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up project", description: "Init the repo" },
            { id: "s2", title: "Write code", description: "Implement the feature" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up project")).toBeDefined();
    expect(screen.getByText("Write code")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "Init the repo")).toBe(true);
    expect(markdownEls.some((el) => el.textContent === "Implement the feature")).toBe(
      true,
    );
  });

  it("does not render the Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions list", () => {
    render(
      <PlanView plan={{ assumptions: ["Node 22 is available", "CI has network access"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "Node 22 is available")).toBe(
      true,
    );
    expect(markdownEls.some((el) => el.textContent === "CI has network access")).toBe(
      true,
    );
  });

  it("does not render the Assumptions section when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks list", () => {
    render(<PlanView plan={{ risks: ["Data migration could fail"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "Data migration could fail"),
    ).toBe(true);
  });

  it("does not render the Risks section when empty", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions and marks required ones with 'blocks execution'", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What DB should we use?", requiredForExecution: true },
            { id: "q2", question: "Any style guide?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();

    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "What DB should we use?")).toBe(
      true,
    );
    expect(markdownEls.some((el) => el.textContent === "Any style guide?")).toBe(true);
  });

  it("does not render the 'blocks execution' tag for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Any style guide?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("does not render the Open Questions section when empty", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a fully populated plan with all sections present at once", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.8,
          summary: "Full plan summary",
          requirementsTraceability: "Traces to REQ-1",
          steps: [{ id: "s1", title: "Do thing", description: "desc" }],
          assumptions: ["assume A"],
          risks: ["risk A"],
          openQuestions: [
            { id: "q1", question: "question A", requiredForExecution: true },
          ],
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
