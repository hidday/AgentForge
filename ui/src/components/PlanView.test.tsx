import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders nothing meaningful for an empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the confidence bar with the done color above 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(screen.getByText("90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the confidence bar with the waiting color between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the confidence bar with the blocked color below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "Plan summary text" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Plan summary text");
  });

  it("renders requirements traceability section when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers req-1, req-2" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers req-1, req-2")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Add migration", description: "Create the table" },
            { id: "s2", title: "Wire endpoint", description: "Add the route" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Add migration")).toBeDefined();
    expect(screen.getByText("Wire endpoint")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Assumption A"],
          risks: ["Risk B"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk B")).toBeDefined();
  });

  it("renders open questions and marks required-for-execution ones as blocking", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Optional detail?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("Optional detail?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render section headers for empty arrays", () => {
    render(<PlanView plan={{ steps: [], assumptions: [], risks: [], openQuestions: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
