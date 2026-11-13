import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders nothing version-related when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a confidence bar when confidence is absent", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".bg-state-done")).toBeNull();
  });

  it("renders a done-colored confidence bar for confidence >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-done");
    expect((bar as HTMLElement).style.width).toBe("85%");
  });

  it("renders a waiting-colored confidence bar for confidence between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-waiting");
  });

  it("renders a blocked-colored confidence bar for confidence below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    const bar = container.querySelector(".h-full");
    expect(bar!.className).toContain("bg-state-blocked");
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "This is the summary." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "This is the summary.",
    );
  });

  it("renders requirements traceability section only when present", () => {
    const { rerender } = render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();

    rerender(<PlanView plan={{ requirementsTraceability: "Maps to REQ-1" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
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
  });

  it("does not render the Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Assumption A", "Assumption B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const markdowns = screen.getAllByTestId("markdown-content");
    expect(markdowns.some((m) => m.textContent === "Assumption A")).toBe(true);
    expect(markdowns.some((m) => m.textContent === "Assumption B")).toBe(true);
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByTestId("markdown-content").textContent).toBe("Risk A");
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

  it("renders nothing extra when plan has no optional sections populated", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
  });
});
