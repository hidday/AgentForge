import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the pulse animation class only for active-category states", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("my-extra-class");
  });

  it("falls back to idle styling for an unrecognized state", () => {
    render(<StateBadge state="TotallyUnknown" />);
    expect(screen.getByText("Totally Unknown")).toBeDefined();
  });
});
