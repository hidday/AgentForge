import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a humanized label for a camel-case state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active pulse class for an active-category state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span") as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-active");
  });

  it("does not apply the pulse class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span") as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-done");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const label = screen.getByText(/Some Unknown State/);
    const wrapper = label.closest("span");
    expect(wrapper?.className).toContain("bg-state-idle-bg");
  });

  it("merges an additional className prop onto the badge", () => {
    render(<StateBadge state="Done" className="extra-class" />);
    const label = screen.getByText("Done");
    const wrapper = label.closest("span");
    expect(wrapper?.className).toContain("extra-class");
  });
});
