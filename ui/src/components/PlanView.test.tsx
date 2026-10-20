import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the Markdown component, matching the pattern used in ChatPanel.test.tsx.
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a completely empty plan (no version, confidence, summary, etc.)", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".bg-border")).toBeNull();
    expect(screen.queryAllByTestId("markdown-content").length).toBe(0);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the done color for confidence >= 0.7 with percentage text", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.75 }} />);
    expect(screen.getByText("75%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the waiting color for confidence between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the blocked color for confidence below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<PlanView plan={{ summary: "Plan summary text" }} />);
    const md = screen.getAllByTestId("markdown-content");
    expect(md.length).toBe(1);
    expect(md[0].textContent).toBe("Plan summary text");
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2")).toBeDefined();
  });

  it("renders steps in order with 1-based numbering", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "First step", description: "Do the first thing" },
            { id: "s2", title: "Second step", description: "Do the second thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("First step")).toBeDefined();
    expect(screen.getByText("Second step")).toBeDefined();
    expect(screen.getByText("Do the first thing")).toBeDefined();
    expect(screen.getByText("Do the second thing")).toBeDefined();
  });

  it("does not render the Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions list when non-empty", () => {
    render(<PlanView plan={{ assumptions: ["Assume A", "Assume B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const md = screen.getAllByTestId("markdown-content").map((el) => el.textContent);
    expect(md).toContain("Assume A");
    expect(md).toContain("Assume B");
  });

  it("does not render the Assumptions section when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks list when non-empty", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("does not render the Risks section when empty", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions, marking required ones as blocking execution", () => {
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
    expect(screen.getByText("Required question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' for non-required questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question?", requiredForExecution: false },
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

  it("renders a fully populated plan with all sections present", () => {
    render(
      <PlanView
        plan={{
          planVersion: 1,
          confidence: 0.8,
          summary: "Overall summary",
          requirementsTraceability: "Traces everything",
          steps: [{ id: "s1", title: "Step one", description: "Desc" }],
          assumptions: ["An assumption"],
          risks: ["A risk"],
          openQuestions: [
            { id: "q1", question: "Q?", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
