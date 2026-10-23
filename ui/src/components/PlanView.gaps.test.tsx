import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView gaps", () => {
  it("uses the 'waiting' (amber) color for a mid-range confidence between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.55 }} />);
    expect(screen.getByText("55%")).toBeDefined();
    const bar = container.querySelector(".h-full.rounded-full") as HTMLElement;
    expect(bar.className).toContain("bg-state-waiting");
    expect(bar.className).not.toContain("bg-state-done");
    expect(bar.className).not.toContain("bg-state-blocked");
  });
});
