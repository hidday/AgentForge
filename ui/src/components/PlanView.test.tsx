import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a completely empty plan (no crash, no sections)", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version tag when planVersion is missing", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  it("renders a done-colored confidence bar and percentage at high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a waiting-colored confidence bar at medium confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a blocked-colored confidence bar at low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary and requirements traceability through Markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Plan summary", requirementsTraceability: "Covers REQ-1" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const markdownBlocks = screen.getAllByTestId("markdown-content");
    expect(markdownBlocks.some((el) => el.textContent === "Plan summary")).toBe(true);
    expect(markdownBlocks.some((el) => el.textContent === "Covers REQ-1")).toBe(true);
  });

  it("renders numbered steps with title and markdown description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up schema", description: "Create the table." },
            { id: "s2", title: "Add endpoint", description: "Wire up the route." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up schema")).toBeDefined();
    expect(screen.getByText("Add endpoint")).toBeDefined();
  });

  it("renders assumptions and risks as bulleted markdown lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Node 22 is available"],
          risks: ["Migration could be slow"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("Migration could be slow")).toBeDefined();
  });

  it("renders open questions and flags required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Any constraints?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("Any constraints?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
