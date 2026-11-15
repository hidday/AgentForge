import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("omits the version label when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the given planVersion", () => {
    render(<PlanView plan={{ planVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("does not render the confidence bar when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders a done-colored confidence bar for high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.8 }} />);
    expect(screen.getByText("80%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a waiting-colored confidence bar for mid confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a blocked-colored confidence bar for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown when present, omits when absent", () => {
    const { rerender } = render(<PlanView plan={{ summary: "Plan summary" }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Plan summary");

    rerender(<PlanView plan={{}} />);
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("renders Requirements Traceability section only when present", () => {
    const { rerender } = render(
      <PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2" }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "Covers REQ-1, REQ-2",
    );

    rerender(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders numbered steps with title and description, omits section when empty", () => {
    const { rerender } = render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step One", description: "Do the first thing" },
            { id: "s2", title: "Step Two", description: "Do the second thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step One")).toBeDefined();
    expect(screen.getByText("Step Two")).toBeDefined();

    rerender(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list, omits section when empty", () => {
    const { rerender } = render(
      <PlanView plan={{ assumptions: ["Assumption A", "Assumption B"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();

    rerender(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks as a bulleted list, omits section when empty", () => {
    const { rerender } = render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();

    rerender(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
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
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("Optional detail?")).toBeDefined();

    const blockingLabels = screen.getAllByText("blocks execution");
    expect(blockingLabels.length).toBe(1);
  });

  it("omits the Open Questions section when the list is empty", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
