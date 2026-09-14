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
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryAllByTestId("markdown-content").length).toBe(0);
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high-confidence score with the 'done' color threshold", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("renders a mid confidence score with the 'waiting' color threshold", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low confidence score with the 'blocked' color threshold", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary and requirements traceability through Markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Do the thing", requirementsTraceability: "Covers REQ-1" }}
      />,
    );
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "Do the thing")).toBe(true);
    expect(markdownEls.some((el) => el.textContent === "Covers REQ-1")).toBe(true);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Write tests", description: "Add unit tests" },
            { id: "s2", title: "Ship it", description: "Deploy to prod" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Write tests")).toBeDefined();
    expect(screen.getByText("Ship it")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["DB is already migrated"],
          risks: ["May break the cache"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("DB is already migrated")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("May break the cache")).toBeDefined();
  });

  it("renders open questions and flags required-for-execution ones", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What DB engine?", requiredForExecution: true },
            { id: "q2", question: "Preferred logging lib?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What DB engine?")).toBeDefined();
    expect(screen.getByText("Preferred logging lib?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' badge for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional Q", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
