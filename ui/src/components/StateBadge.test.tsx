import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted state name by splitting camel case", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders the active pulsing dot for an active-category state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not render the pulsing dot for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).toBeNull();
  });

  it("falls back to the idle category classes for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("applies an additional className when provided", () => {
    const { container } = render(
      <StateBadge state="Todo" className="my-extra-class" />,
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("my-extra-class");
  });
});
