import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders only the header when the plan has no optional fields", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders version and a confidence bar colored by thresholds", () => {
    const { rerender } = render(<PlanView plan={{ planVersion: 3, confidence: 0.9 }} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();

    rerender(<PlanView plan={{ planVersion: 1, confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
  });

  it("renders the summary and requirements traceability through Markdown", () => {
    render(
      <PlanView
        plan={{ summary: "This plan does X", requirementsTraceability: "Covers REQ-1" }}
      />,
    );
    const mdBlocks = screen.getAllByTestId("md");
    expect(mdBlocks.map((el) => el.textContent)).toContain("This plan does X");
    expect(mdBlocks.map((el) => el.textContent)).toContain("Covers REQ-1");
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up DB", description: "Create tables" },
            { id: "s2", title: "Write API", description: "Add routes" },
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

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["API is stable"],
          risks: ["Migration could lock the table"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("API is stable")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could lock the table")).toBeDefined();
  });

  it("renders open questions and flags ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which DB engine?", requiredForExecution: true },
            { id: "q2", question: "Should we log this?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which DB engine?")).toBeDefined();
    expect(screen.getByText("Should we log this?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render a confidence bar when confidence is absent", () => {
    render(<PlanView plan={{ planVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
