import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("formats a camel-case state name into spaced words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active-category badge class and pulsing dot for an active state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge!.className).toContain("state-active");
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not pulse the dot for a non-active category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge!.className).toContain("state-done");
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge!.className).toContain("state-idle");
  });

  it("merges an additional className onto the badge", () => {
    render(<StateBadge state="Todo" className="extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge!.className).toContain("extra-class");
  });
});
