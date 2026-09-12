import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { formatTimestamp } from "@/lib/utils.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events newest first", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case words", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("shows the from/to transition when present in the payload", () => {
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

  it("does not show a transition row when payload has no from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ payloadJson: { feedback: "x" } })]} />,
    );
    // no font-mono transition spans should be present
    expect(container.querySelectorAll("span.font-mono").length).toBe(0);
  });

  it("shows rejection feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Please simplify step 2" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Please simplify step 2")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "irrelevant here" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("irrelevant here")).toBeNull();
  });

  it("uses the done color for an approved-style event icon", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("uses the done color for EXECUTION_FINISHED and REMEDIATION_FINISHED", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "e2", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );
    expect(container.querySelectorAll("svg.text-state-done").length).toBe(2);
  });

  it("uses the blocked color for a rejected/changes-requested/blocked event icon", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
          makeEvent({ id: "e3", eventType: "BLOCKED" }),
        ]}
      />,
    );
    expect(container.querySelectorAll("svg.text-state-blocked").length).toBe(3);
  });

  it("falls back to a Zap icon for a completely unknown event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(container.querySelector("svg.lucide-zap")).not.toBeNull();
  });

  it("falls back to the accent color for an unrecognized/neutral event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    expect(container.querySelector("svg.text-accent")).not.toBeNull();
    expect(container.querySelector("svg.text-state-done")).toBeNull();
    expect(container.querySelector("svg.text-state-blocked")).toBeNull();
  });

  it("shows the event source label and uses a User icon for human sources", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "human" })]} />,
    );
    expect(screen.getByText("human")).toBeDefined();
    expect(container.querySelector("svg.lucide-user")).not.toBeNull();
  });

  it("falls back to a Bot icon for a non-human source", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "planner-agent" })]} />,
    );
    expect(screen.getByText("planner-agent")).toBeDefined();
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("sets a title attribute with the full formatted timestamp", () => {
    const createdAt = "2024-03-05T10:15:00Z";
    render(<EventTimeline events={[makeEvent({ createdAt })]} />);
    const timeEl = screen.getByTitle(formatTimestamp(createdAt));
    expect(timeEl).toBeDefined();
  });
});
