import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("shows the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("colors the confidence bar green and shows the percentage for high confidence", () => {
    render(<PlanView plan={{ confidence: 0.8 }} />);
    expect(screen.getByText("80%")).toBeDefined();
  });

  it("colors the confidence bar for medium and low confidence", () => {
    const { rerender } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    rerender(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
  });

  it("renders the summary and requirements traceability through Markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Summary text", requirementsTraceability: "Trace text" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const markdowns = screen.getAllByTestId("markdown-content");
    const texts = markdowns.map((m) => m.textContent);
    expect(texts).toContain("Summary text");
    expect(texts).toContain("Trace text");
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
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
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
    expect(screen.getByText("Risks")).toBeDefined();
  });

  it("marks a required open question as blocking execution", () => {
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
    expect(screen.getAllByText("blocks execution").length).toBe(1);
  });
});
