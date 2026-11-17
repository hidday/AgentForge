import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("formats a known event type and shows its source", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED", source: "human" })]}
      />,
    );

    expect(screen.getByText("Plan Review Approved")).toBeDefined();
    expect(screen.getByText("human")).toBeDefined();
  });

  it("formats an unknown event type and source without crashing (fallback icons)", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "SOME_CUSTOM_EVENT", source: "ci-bot" })]}
      />,
    );

    expect(screen.getByText("Some Custom Event")).toBeDefined();
    expect(screen.getByText("ci-bot")).toBeDefined();
  });

  it("renders the from/to transition when present in the payload", () => {
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

  it("renders feedback text only for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on step 3" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Needs more detail on step 3")).toBeDefined();
  });

  it("does not render feedback for a non-PLAN_REJECTED event even if payload has it", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVISED",
            payloadJson: { feedback: "should be ignored" },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("should be ignored")).toBeNull();
  });

  it("renders events most-recent-first", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];

    const { container } = render(<EventTimeline events={events} />);
    const titles = Array.from(
      container.querySelectorAll(".text-xs.font-medium.text-text-primary"),
    ).map((el) => el.textContent);

    expect(titles).toEqual(["Plan Created", "Run Requested"]);
  });
});
