import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active dot animation class for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const dot = screen.getByText("Implementing").firstElementChild as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-active");
  });

  it("does not apply the pulse animation for a non-active state", () => {
    render(<StateBadge state="Done" />);
    const dot = screen.getByText("Done").firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-done");
  });

  it("merges a custom className onto the badge root", () => {
    render(<StateBadge state="Done" className="my-extra-class" />);
    const root = screen.getByText("Done").closest("span.inline-flex") as HTMLElement;
    expect(root.className).toContain("my-extra-class");
  });

  it("falls back to idle styling for an unrecognized state", () => {
    render(<StateBadge state="NotARealState" />);
    const root = screen.getByText("Not A Real State").closest("span.inline-flex") as HTMLElement;
    expect(root.className).toContain("state-idle");
  });
});
