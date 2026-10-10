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
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state and no heading when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders an APPROVED-type event with the done-color icon and the human source icon", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "ev-1", eventType: "PLAN_APPROVED", source: "human" })]}
      />,
    );

    expect(screen.getByText("Plan Approved")).toBeDefined();

    const doneIcon = container.querySelector(".lucide-circle-check");
    expect(doneIcon).toBeDefined();
    expect(doneIcon!.getAttribute("class")).toContain("text-state-done");

    expect(screen.getByText("human")).toBeDefined();
    expect(container.querySelector(".lucide-user")).toBeDefined();
    expect(container.querySelector(".lucide-bot")).toBeNull();
  });

  it("renders a BLOCKED event with the blocked-color icon and falls back to the Bot source icon for an unrecognized source", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "ev-1", eventType: "BLOCKED", source: "scheduler" })]}
      />,
    );

    expect(screen.getByText("Blocked")).toBeDefined();

    const blockedIcon = container.querySelector(".lucide-triangle-alert");
    expect(blockedIcon).toBeDefined();
    expect(blockedIcon!.getAttribute("class")).toContain("text-state-blocked");

    expect(screen.getByText("scheduler")).toBeDefined();
    expect(container.querySelector(".lucide-bot")).toBeDefined();
    expect(container.querySelector(".lucide-user")).toBeNull();
  });

  it("falls back to the default Zap icon for an unrecognized eventType without crashing", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "ev-1", eventType: "SOME_UNKNOWN_TYPE", source: "human" })]}
      />,
    );

    expect(screen.getByText("Some Unknown Type")).toBeDefined();
    const icon = container.querySelector(".lucide-zap");
    expect(icon).toBeDefined();
    expect(icon!.getAttribute("class")).toContain("text-accent");
  });

  it("renders italic feedback text for a PLAN_REJECTED event that has feedback, but not for one that lacks it", () => {
    const events = [
      makeEvent({
        id: "ev-no-feedback",
        eventType: "PLAN_REJECTED",
        payloadJson: {},
      }),
      makeEvent({
        id: "ev-with-feedback",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more test coverage" },
      }),
    ];

    const { container } = render(<EventTimeline events={events} />);

    // Events render reversed: ev-with-feedback (last in array) comes first in the DOM.
    const cards = container.querySelectorAll(".group");
    expect(cards.length).toBe(2);

    const [firstCard, secondCard] = Array.from(cards) as HTMLElement[];
    expect(firstCard.textContent).toContain("Needs more test coverage");
    expect(firstCard.querySelector(".italic")).toBeDefined();

    expect(secondCard.textContent).not.toContain("Needs more test coverage");
    expect(secondCard.querySelector(".italic")).toBeNull();

    // Both are PLAN_REJECTED -> both get the blocked-color icon.
    expect(firstCard.querySelector(".lucide-circle-x")).toBeDefined();
    expect(secondCard.querySelector(".lucide-circle-x")).toBeDefined();
  });

  it("renders a from->to transition line when the payload has both fields", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({
            id: "ev-1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing", to: "Todo" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
    expect(container.querySelector(".lucide-arrow-right")).toBeDefined();
  });

  it("does not render a transition line when the payload is missing from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "ev-1", eventType: "RUN_REQUESTED", payloadJson: { to: "Todo" } })]}
      />,
    );

    expect(container.querySelector(".lucide-arrow-right")).toBeNull();
  });

  it("renders events in reversed order, newest (last array entry) first", () => {
    const events = [
      makeEvent({ id: "ev-first", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "ev-second", eventType: "EXECUTION_FINISHED" }),
    ];

    const { container } = render(<EventTimeline events={events} />);

    const labels = Array.from(
      container.querySelectorAll(".text-xs.font-medium.text-text-primary"),
    ).map((el) => el.textContent);

    expect(labels).toEqual(["Execution Finished", "Run Requested"]);
  });
});
