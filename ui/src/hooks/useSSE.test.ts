import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {}
}

let instances: FakeEventSource[] = [];

describe("useSSE", () => {
  beforeEach(() => {
    instances = [];
    vi.stubGlobal(
      "EventSource",
      class extends FakeEventSource {
        constructor(url: string) {
          super(url);
          instances.push(this);
        }
      },
    );
  });

  it("constructs an EventSource pointed at /api/events/stream", () => {
    renderHook(() => useSSE(() => {}));
    expect(instances.length).toBe(1);
    expect(instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes onEvent with the parsed event on a valid JSON message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    instances[0]!.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("swallows malformed JSON messages without calling onEvent or throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => {
      instances[0]!.onmessage!({ data: "{not valid json" });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const source = instances[0]!;
    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("fires the latest onEvent passed on rerender, without re-subscribing", () => {
    const firstOnEvent = vi.fn();
    const secondOnEvent = vi.fn();

    const { rerender } = renderHook(({ onEvent }) => useSSE(onEvent), {
      initialProps: { onEvent: firstOnEvent },
    });

    rerender({ onEvent: secondOnEvent });

    // Only one EventSource should ever have been constructed.
    expect(instances.length).toBe(1);

    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    instances[0]!.onmessage!({ data: JSON.stringify(event) });

    expect(firstOnEvent).not.toHaveBeenCalled();
    expect(secondOnEvent).toHaveBeenCalledTimes(1);
    expect(secondOnEvent).toHaveBeenCalledWith(event);
  });
});
