import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the formatted event type for a known event", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED", source: "ai" })]}
      />,
    );
    expect(screen.getByText("Plan Created")).toBeDefined();
    expect(screen.getByText("ai")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ id: "ev-1", eventType: "RUN_REQUESTED" }),
          makeEvent({ id: "ev-2", eventType: "PLAN_CREATED" }),
        ]}
      />,
    );
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders feedback text for a PLAN_REJECTED event", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollback." },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollback.")).toBeDefined();
  });

  it("does not render feedback text for non-PLAN_REJECTED events even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("falls back to Bot source icon for an unknown source", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ source: "ai-agent" })]}
      />,
    );
    expect(screen.getByText("ai-agent")).toBeDefined();
    // Bot icon renders as an svg; just assert the row rendered without throwing
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("falls back to Zap icon for an unrecognized event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOMETHING_NEW" })]} />);
    expect(screen.getByText("Something New")).toBeDefined();
  });

  it("applies the done color for an approved event type", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "HUMAN_APPROVED" })]}
      />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-done");
  });

  it("applies the blocked color for a BLOCKED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-blocked");
  });

  it("renders a title attribute with the full formatted timestamp", () => {
    render(<EventTimeline events={[makeEvent({})]} />);
    const timeEl = screen.getByTitle(/\d{4}|\w{3} \d/);
    expect(timeEl).toBeDefined();
  });
});
