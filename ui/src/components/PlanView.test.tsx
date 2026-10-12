import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders minimally when the plan object is empty", () => {
    const { container } = render(<PlanView plan={{}} />);
    // No version, no confidence bar, no summary, no sections — just the header shell.
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage when confidence is set", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("colors the confidence bar green for high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("colors the confidence bar amber for medium confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the confidence bar red for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "This is the plan summary",
    );
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2" }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getAllByTestId("markdown-content").some((el) =>
      el.textContent?.includes("REQ-1"),
    )).toBe(true);
  });

  it("renders a numbered list of steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up DB", description: "Create schema" },
            { id: "s2", title: "Write API", description: "Add endpoints" },
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

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView plan={{ assumptions: ["Assumes Node 22", "Assumes pnpm"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getAllByTestId("markdown-content").length).toBeGreaterThan(0);
  });

  it("renders risks with a warning icon section", () => {
    render(<PlanView plan={{ risks: ["Migration could fail"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
  });

  it("renders open questions and flags ones required for execution", () => {
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
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' for optional open questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Any limits?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders a fully populated plan end-to-end", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.75,
          summary: "Summary text",
          requirementsTraceability: "Trace text",
          steps: [{ id: "s1", title: "Step one", description: "Do it" }],
          assumptions: ["Assumption one"],
          risks: ["Risk one"],
          openQuestions: [
            { id: "q1", question: "Question one", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
