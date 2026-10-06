import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects to /api/events/stream on mount", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses an incoming message and invokes the callback with the parsed event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    MockEventSource.instances[0]!.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("uses the latest callback without reconnecting when the callback identity changes", () => {
    const first = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    const second = vi.fn();
    rerender({ cb: second });

    // Still only one EventSource — the effect that creates it has an empty dep array.
    expect(MockEventSource.instances).toHaveLength(1);

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    MockEventSource.instances[0]!.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("swallows malformed JSON in a message without throwing or invoking the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => {
      MockEventSource.instances[0]!.onmessage!({ data: "{not valid json" });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(() => {
      MockEventSource.instances[0]!.onerror!();
    }).not.toThrow();
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));

    const instance = MockEventSource.instances[0]!;
    expect(instance.closed).toBe(false);

    unmount();

    expect(instance.closed).toBe(true);
  });
});
