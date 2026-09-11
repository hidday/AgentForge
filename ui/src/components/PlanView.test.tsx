import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing but the wrapper for an empty plan", () => {
    render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it.each([
    [0.85, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("renders the confidence bar at %s with class %s", (confidence, cls) => {
    const { container } = render(
      <PlanView plan={{ confidence }} />,
    );
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
    const bar = container.querySelector(`.${cls}`);
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe(`${confidence * 100}%`);
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "This is the plan summary.",
    );
  });

  it("renders requirements traceability through Markdown with its heading", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "REQ-1 covered by step 2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(
      screen.getByText("REQ-1 covered by step 2"),
    ).toBeDefined();
  });

  it("renders steps with index, title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up project", description: "Init repo" },
            { id: "s2", title: "Write code", description: "Implement feature" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up project")).toBeDefined();
    expect(screen.getByText("Write code")).toBeDefined();
    expect(screen.getByText("Init repo")).toBeDefined();
    expect(screen.getByText("Implement feature")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView plan={{ assumptions: ["Assumption A", "Assumption B"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions and marks required-for-execution ones", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            {
              id: "q1",
              question: "Which region?",
              requiredForExecution: true,
            },
            {
              id: "q2",
              question: "Any style preference?",
              requiredForExecution: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which region?")).toBeDefined();
    expect(screen.getByText("Any style preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
