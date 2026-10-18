import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders an empty plan without any of the optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/Steps/)).toBeNull();
    expect(screen.queryByText(/Assumptions/)).toBeNull();
    expect(screen.queryByText(/Risks/)).toBeNull();
    expect(screen.queryByText(/Open Questions/)).toBeNull();
    expect(screen.queryByText(/Requirements Traceability/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    // header row div + outer wrapper exist, but version span absent
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("renders the confidence bar with the right color band for %s", (confidence, expectedClass) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
    const bar = container.querySelector(`.${expectedClass}`);
    expect(bar).not.toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "This is the plan summary.",
    );
  });

  it("renders requirements traceability section with heading and content", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "Covers REQ-1 and REQ-2.")).toBe(
      true,
    );
  });

  it("renders numbered steps with title and description", () => {
    const plan = {
      steps: [
        { id: "s1", title: "Set up DB", description: "Create tables." },
        { id: "s2", title: "Write API", description: "Add endpoints." },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up DB")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    const plan = { assumptions: ["Assumption A", "Assumption B"] };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    const texts = markdownEls.map((el) => el.textContent);
    expect(texts).toContain("Assumption A");
    expect(texts).toContain("Assumption B");
  });

  it("renders risks as a bulleted list", () => {
    const plan = { risks: ["Risk A", "Risk B"] };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Risks")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    const texts = markdownEls.map((el) => el.textContent);
    expect(texts).toContain("Risk A");
    expect(texts).toContain("Risk B");
  });

  it("renders open questions, marking ones required for execution", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "What auth method?", requiredForExecution: true },
        { id: "q2", question: "Which region?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    const texts = markdownEls.map((el) => el.textContent);
    expect(texts).toContain("What auth method?");
    expect(texts).toContain("Which region?");
  });

  it("does not render the 'blocks execution' tag for a question not required for execution", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Optional question", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders a fully populated plan with all sections together", () => {
    const plan = {
      planVersion: 2,
      confidence: 0.85,
      summary: "Full summary",
      requirementsTraceability: "Trace info",
      steps: [{ id: "s1", title: "Step one", description: "Desc one" }],
      assumptions: ["Assume one"],
      risks: ["Risk one"],
      openQuestions: [
        { id: "q1", question: "Question one", requiredForExecution: true },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
