import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders minimally for an empty plan object (no version/confidence/summary/etc.)", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelectorAll('[data-testid="markdown-content"]').length).toBe(0);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a done-colored confidence bar and percentage for confidence >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("renders a waiting-colored confidence bar for 0.4 <= confidence < 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a blocked-colored confidence bar for confidence < 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "This is the plan summary.",
    );
  });

  it("renders requirements traceability through Markdown when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2." }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1, REQ-2.")).toBeDefined();
  });

  it("does not render requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders numbered steps with title and markdown description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up scaffolding", description: "Create the base files." },
            { id: "s2", title: "Wire up routes", description: "Add the router." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up scaffolding")).toBeDefined();
    expect(screen.getByText("Wire up routes")).toBeDefined();
    const mdEls = screen.getAllByTestId("markdown-content");
    expect(mdEls.map((el) => el.textContent)).toContain("Create the base files.");
  });

  it("renders assumptions as a bulleted markdown list", () => {
    render(<PlanView plan={{ assumptions: ["Assumption one", "Assumption two"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const mdEls = screen.getAllByTestId("markdown-content");
    expect(mdEls.map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Assumption one", "Assumption two"]),
    );
  });

  it("renders risks as a bulleted markdown list", () => {
    render(<PlanView plan={{ risks: ["Risk one"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByTestId("markdown-content").textContent).toBe("Risk one");
  });

  it("renders open questions with a 'blocks execution' tag for required ones only", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Any nice-to-haves?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("Any nice-to-haves?")).toBeDefined();
    expect(screen.getAllByText("blocks execution").length).toBe(1);
  });

  it("renders a fully populated plan end-to-end", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.9,
          summary: "Summary text",
          requirementsTraceability: "Traces requirements",
          steps: [{ id: "s1", title: "Step 1", description: "Desc 1" }],
          assumptions: ["A1"],
          risks: ["R1"],
          openQuestions: [{ id: "q1", question: "Q1?", requiredForExecution: true }],
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
