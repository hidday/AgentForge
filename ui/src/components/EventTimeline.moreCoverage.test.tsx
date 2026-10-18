import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & { eventType: string },
): RunEventRecord {
  return {
    id: overrides.id ?? "evt-1",
    runId: "run-1",
    source: overrides.source ?? "ai-agent",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline – unknown event type icon fallback", () => {
  it("falls back to the default Zap icon for an event type not in the icon map", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "SOME_UNMAPPED_EVENT" })]}
      />,
    );

    // The event still renders with its formatted label even without a
    // dedicated icon mapping.
    expect(screen.getByText("Some Unmapped Event")).toBeDefined();
    // An icon (the Zap fallback) is still rendered inside the block.
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
