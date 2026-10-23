import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView gaps", () => {
  it("colors the score bar as 'waiting' (amber) for a mid-range score between 0.4 and 0.7", () => {
    render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    const bar = document.querySelector(".h-full.rounded-full") as HTMLElement;
    expect(bar.className).toContain("bg-state-waiting");
    expect(bar.className).not.toContain("bg-state-done");
    expect(bar.className).not.toContain("bg-state-blocked");
  });

  it("colors the score bar as 'blocked' (red) for a low score below 0.4", () => {
    render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    const bar = document.querySelector(".h-full.rounded-full") as HTMLElement;
    expect(bar.className).toContain("bg-state-blocked");
    expect(bar.className).not.toContain("bg-state-done");
    expect(bar.className).not.toContain("bg-state-waiting");
  });
});
