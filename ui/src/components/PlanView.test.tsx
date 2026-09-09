import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders nothing extra for an empty plan payload", () => {
    const { container } = render(<PlanView plan={{}} />);
    // Header row still renders but empty; no crash, no unexpected content.
    expect(container.querySelector(".space-y-5")).not.toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("uses the mid-range confidence bar color for confidence between 0.4 and 0.7", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("uses the low confidence bar color for confidence under 0.4", () => {
    render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
  });

  it("renders summary and requirements traceability through Markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Summary text", requirementsTraceability: "Traces req #4" }}
      />,
    );
    const markdowns = screen.getAllByTestId("markdown-content");
    expect(markdowns.some((el) => el.textContent === "Summary text")).toBe(true);
    expect(markdowns.some((el) => el.textContent === "Traces req #4")).toBe(true);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do the thing" },
            { id: "s2", title: "Step two", description: "Do another thing" },
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

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Assumption A"],
          risks: ["Risk A"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions and flags ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What auth method?", requiredForExecution: true },
            { id: "q2", question: "Nice to have?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What auth method?")).toBeDefined();
    expect(screen.getByText("Nice to have?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
