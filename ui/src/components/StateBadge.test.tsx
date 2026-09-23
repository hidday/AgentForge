import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted (space-separated) state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies active category styling and a pulsing dot for an active state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const badge = container.querySelector("span");
    const dot = badge?.querySelector("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not pulse the dot for a non-active (waiting) state", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const dot = container.querySelector("span")?.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-waiting");
  });

  it("renders blocked styling for a blocked state", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("renders done styling for the Done state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("falls back to idle styling for an unrecognized state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-custom-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("my-custom-class");
  });
});
