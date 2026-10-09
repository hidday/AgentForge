import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders only the (empty) header when the plan has no fields", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".space-y-5")).not.toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version label when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the confidence percentage and applies 'done' color at >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("applies 'waiting' color for confidence between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("applies 'blocked' color for confidence below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "Plan summary text" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "Plan summary text",
    );
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView plan={{ requirementsTraceability: "Covers requirement R1." }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getAllByTestId("markdown-content")[0].textContent).toContain(
      "Covers requirement R1.",
    );
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do the first thing" },
            { id: "s2", title: "Step two", description: "Do the second thing" },
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

  it("renders assumptions list items", () => {
    render(<PlanView plan={{ assumptions: ["Assume A", "Assume B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    const texts = markdownEls.map((el) => el.textContent);
    expect(texts).toContain("Assume A");
    expect(texts).toContain("Assume B");
  });

  it("renders risks list items", () => {
    render(<PlanView plan={{ risks: ["Risk one"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByTestId("markdown-content").textContent).toBe("Risk one");
  });

  it("renders open questions and marks required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Required question?", requiredForExecution: true },
            { id: "q2", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getAllByText("blocks execution")).toHaveLength(1);
  });

  it("does not render section headers for empty arrays", () => {
    render(<PlanView plan={{ steps: [], assumptions: [], risks: [], openQuestions: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
