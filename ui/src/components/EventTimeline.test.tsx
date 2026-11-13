import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & { id: string; eventType: string },
): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: overrides.eventType,
    source: overrides.source ?? "ai",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "PLAN_CREATED" })]}
      />,
    );
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders the from/to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Failed", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a from/to row when payload lacks those fields", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "RUN_REQUESTED", payloadJson: null })]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout." },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout.")).toBeDefined();
  });

  it("does not render feedback paragraph for non-PLAN_REJECTED events even with a feedback field", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source text", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back to the Zap icon for an unknown event type without crashing", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "SOME_UNKNOWN_EVENT" })]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("colors APPROVED-ish event icons with the done state class", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "PLAN_REVIEW_APPROVED" })]}
      />,
    );
    const icon = container.querySelector("svg");
    expect(icon!.getAttribute("class")).toContain("text-state-done");
  });

  it("colors REJECTED/CHANGES_REQUESTED/BLOCKED event icons with the blocked state class", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ id: "e1", eventType: "BLOCKED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon!.getAttribute("class")).toContain("text-state-blocked");
  });

  it("colors other event icons with the accent class", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ id: "e1", eventType: "RUN_REQUESTED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon!.getAttribute("class")).toContain("text-accent");
  });
});
