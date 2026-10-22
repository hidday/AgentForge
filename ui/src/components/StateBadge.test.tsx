import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a humanized label for a known active state and marks it animated", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    expect(screen.getByText("Implementing")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("splits camel-case state names into words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("does not animate the dot for a non-active category (e.g. Done)", () => {
    const { container } = render(<StateBadge state="Done" />);
    expect(screen.getByText("Done")).toBeDefined();
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("falls back to the idle category styling for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("merges an extra className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="extra-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("extra-class");
  });
});
