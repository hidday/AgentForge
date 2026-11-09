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
  let originalEventSource: unknown;

  beforeEach(() => {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    FakeEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).EventSource = originalEventSource;
  });

  it("opens a connection to the events stream endpoint", () => {
    renderHook(() => useSSE(() => {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("forwards parsed message events to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores malformed event payloads instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is implicit)", () => {
    renderHook(() => useSSE(() => {}));
    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("always calls the latest callback even if the callback identity changes between renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
    // Only one EventSource should have been created across the rerender,
    // since the connection effect has an empty dependency array.
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
