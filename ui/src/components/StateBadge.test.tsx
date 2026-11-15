import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active dot pulse animation for an active-category state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span") as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation for a non-active-category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span") as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("merges a caller-provided className onto the badge", () => {
    render(<StateBadge state="Done" className="custom-class" />);
    expect(screen.getByText("Done").className).toContain("custom-class");
  });

  it("falls back to the idle styling for an unrecognized state", () => {
    render(<StateBadge state="TotallyUnknown" />);
    expect(screen.getByText("Totally Unknown").className).toContain("state-idle");
  });
});
