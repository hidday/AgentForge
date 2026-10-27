import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a human-readable, space-separated label for a CamelCase state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the pulsing-dot animation class for an active-category state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    const dot = badge.querySelector("span") as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulsing-dot animation class for a non-active state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    const dot = badge.querySelector("span") as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category styling for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Done" className="my-extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
