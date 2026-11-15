import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and a humanized event type for known events", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("humanizes an event type it has no icon mapping for, using the default icon", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("shows a from -> to transition when payload has both from and to", () => {
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

  it("does not render a transition row when only one of from/to is present", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing" },
          }),
        ]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows feedback text for a PLAN_REJECTED event with payload.feedback", () => {
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

  it("does not show feedback text for other event types even if payload.feedback is set", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "Should not appear" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not appear")).toBeNull();
  });

  it("renders the event source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("applies the done color to an APPROVED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("applies the blocked color to a BLOCKED event type", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />);
    const icon = container.querySelector("svg.text-state-blocked");
    expect(icon).not.toBeNull();
  });

  it("applies the accent color to an event type that is neither approved/finished nor rejected/blocked", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_STARTED" })]} />,
    );
    const icon = container.querySelector("svg.text-accent");
    expect(icon).not.toBeNull();
  });

  it("applies the done color to EXECUTION_FINISHED and REMEDIATION_FINISHED event types", () => {
    const { container: c1 } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    expect(c1.querySelector("svg.text-state-done")).not.toBeNull();

    const { container: c2 } = render(
      <EventTimeline events={[makeEvent({ eventType: "REMEDIATION_FINISHED" })]} />,
    );
    expect(c2.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("applies the blocked color to events matching REJECTED or CHANGES_REQUESTED", () => {
    const { container: c1 } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />,
    );
    expect(c1.querySelector("svg.text-state-blocked")).not.toBeNull();

    const { container: c2 } = render(
      <EventTimeline events={[makeEvent({ eventType: "REVIEW_CHANGES_REQUESTED" })]} />,
    );
    expect(c2.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("handles a null payloadJson without throwing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
  });
});
