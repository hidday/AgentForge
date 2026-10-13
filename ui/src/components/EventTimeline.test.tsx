import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and formatted event type when events exist", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED" })]}
      />,
    );

    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("shows the from/to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition when payload is missing from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]}
      />,
    );

    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not show feedback for PLAN_REJECTED when payload has none", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]}
      />,
    );

    expect(screen.getByText("Plan Rejected")).toBeDefined();
    expect(screen.queryByText(/Needs more detail/)).toBeNull();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "should not render" },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("should not render")).toBeNull();
  });

  it("renders the event source text", () => {
    render(
      <EventTimeline
        events={[makeEvent({ source: "human" })]}
      />,
    );

    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a relative time with the full timestamp as a title attribute", () => {
    const createdAt = "2024-01-01T00:00:00.000Z";
    render(<EventTimeline events={[makeEvent({ createdAt })]} />);

    const timeEl = screen.getByText(/ago|just now/);
    expect(timeEl.getAttribute("title")).toContain("Jan");
  });

  it("falls back to the default icon/style for an unrecognized event type and source", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT", source: "unknown-source" })]}
      />,
    );

    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(screen.getByText("unknown-source")).toBeDefined();
  });

  it("applies the 'done' style to EXECUTION_FINISHED and REMEDIATION_FINISHED events", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "e2", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );

    const doneIcons = container.querySelectorAll(".text-state-done");
    expect(doneIcons.length).toBe(2);
  });

  it("applies the 'blocked' style to BLOCKED and CHANGES_REQUESTED events", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "BLOCKED" }),
          makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
        ]}
      />,
    );

    const blockedIcons = container.querySelectorAll(".text-state-blocked");
    expect(blockedIcons.length).toBe(2);
  });
});
