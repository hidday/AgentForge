import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a plan with no optional fields", () => {
    render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version badge when planVersion is set", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("colors the confidence bar for confidence=%s", (confidence, expectedClass) => {
    const { container } = render(<PlanView plan={{ confidence }} />);
    const fill = container.querySelector(`.${expectedClass}`);
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe(`${confidence * 100}%`);
    expect(screen.getByText(`${Math.round(confidence * 100)}%`)).toBeDefined();
  });

  it("renders the summary through Markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary" }} />);
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "This is the plan summary")).toBe(true);
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView plan={{ requirementsTraceability: "Covers req A and req B" }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "Covers req A and req B")).toBe(true);
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
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "Do the first thing")).toBe(true);
    expect(md.some((el) => el.textContent === "Do the second thing")).toBe(true);
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Assumes Node 22", "Assumes pnpm"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "Assumes Node 22")).toBe(true);
    expect(md.some((el) => el.textContent === "Assumes pnpm")).toBe(true);
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Could break CI", "Migration risk"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "Could break CI")).toBe(true);
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
    expect(screen.getByText("blocks execution")).toBeDefined();
    const md = screen.getAllByTestId("markdown-content");
    expect(md.some((el) => el.textContent === "Required question?")).toBe(true);
    expect(md.some((el) => el.textContent === "Optional question?")).toBe(true);
  });
});
