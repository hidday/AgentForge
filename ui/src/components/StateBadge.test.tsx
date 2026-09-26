import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted label for a CamelCase state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders the pulsing dot for an active-category state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("does not add the pulse animation for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span span");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category classes for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="custom-class" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toContain("custom-class");
  });
});
