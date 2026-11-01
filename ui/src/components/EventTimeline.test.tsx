import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";

vi.mock("@/lib/utils.ts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils.ts")>("@/lib/utils.ts");
  return {
    ...actual,
    relativeTime: vi.fn(() => "2h ago"),
    formatTimestamp: vi.fn(() => "Jan 1, 12:00:00"),
  };
});

import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: overrides.id ?? "ev-1",
    runId: "run-1",
    eventType: overrides.eventType ?? "RUN_REQUESTED",
    source: overrides.source ?? "ai",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events in reverse order (most recently appended first)", () => {
    const events = [
      makeEvent({ id: "first", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "second", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats the event type by replacing underscores and title-casing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />);
    expect(screen.getByText("Execution Finished")).toBeDefined();
  });

  it("falls back to the Zap icon class styling for an unrecognized event type (default accent color)", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-accent");
  });

  it("uses the done color for an approved/finished event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-done");
  });

  it("uses the blocked color for a rejected/changes-requested/blocked event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-blocked");
  });

  it("renders a from -> to transition when the payload carries both fields", () => {
    const events = [
      makeEvent({ eventType: "RESET_TO_TODO", payloadJson: { from: "Failed", to: "Todo" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition row when payload lacks from/to", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: { other: 1 } })]} />);
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    const events = [
      makeEvent({ eventType: "PLAN_REJECTED", payloadJson: { feedback: "needs more detail" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("needs more detail")).toBeDefined();
  });

  it("does not render feedback paragraph for non-rejection events even if payload has a feedback field", () => {
    const events = [
      makeEvent({ eventType: "PLAN_CREATED", payloadJson: { feedback: "should not show" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the human source icon for a human-sourced event and shows the source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back to the Bot icon for an unrecognized source", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-agent" })]} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("shows the mocked relative time and sets the full timestamp as a title attribute", () => {
    render(<EventTimeline events={[makeEvent({})]} />);
    expect(screen.getByText("2h ago")).toBeDefined();
    expect(screen.getByText("2h ago").getAttribute("title")).toBe("Jan 1, 12:00:00");
  });
});
