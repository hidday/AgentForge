import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name for a simple state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("formats a camel-case multi-word state with spaces", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active dot animation class for active-category states", () => {
    render(<StateBadge state="Implementing" />);
    // The dot is the inner span; find it via the badge's own child.
    const badge = screen.getByText("Implementing").closest("span");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the active dot animation class for non-active-category states", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    const dot = badge?.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category styling for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Done" className="my-extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
