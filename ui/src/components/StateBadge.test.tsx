import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a spaced-out label for a PascalCase state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("shows a pulsing dot for an active-category state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("does not pulse the dot for a non-active-category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("applies a custom className to the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toContain("my-extra-class");
  });

  it("falls back to the idle badge style for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });
});
