import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource against the SSE stream endpoint", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage?.({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("swallows malformed message data without throwing or invoking the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onmessage?.({ data: "not-json{{" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the underlying EventSource errors", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror?.()).not.toThrow();
  });

  it("always calls the latest callback even if the identity changes between renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage?.({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
    // Only one EventSource should have been created across rerenders.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the EventSource on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });
});
