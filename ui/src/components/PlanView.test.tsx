import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing substantive for an empty plan", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a confidence bar and percentage when confidence is present", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("uses the done color for high confidence", () => {
    render(<PlanView plan={{ confidence: 0.9 }} />);
    const bar = document.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("uses the waiting color for medium confidence", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = document.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });

  it("uses the blocked color for low confidence", () => {
    render(<PlanView plan={{ confidence: 0.1 }} />);
    const bar = document.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "Plan summary" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Plan summary");
  });

  it("renders requirements traceability section when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders steps with index numbers and titles", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "First step", description: "do thing" },
            { id: "s2", title: "Second step", description: "do other thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("First step")).toBeDefined();
    expect(screen.getByText("Second step")).toBeDefined();
  });

  it("renders assumptions as a list", () => {
    render(<PlanView plan={{ assumptions: ["Assumption A", "Assumption B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
  });

  it("renders risks as a list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
  });

  it("renders open questions and marks required ones as blocking execution", () => {
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
    expect(screen.getAllByText("blocks execution")).toHaveLength(1);
  });

  it("does not render the version span content when planVersion is absent", () => {
    render(<PlanView plan={{ summary: "x" }} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });
});
