import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event("error"));
  }
}

describe("useSSE", () => {
  let originalEventSource: unknown;

  beforeEach(() => {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).EventSource = originalEventSource;
  });

  it("opens an EventSource connection to /api/events/stream on mount", () => {
    renderHook(() => useSSE(() => {}));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event when a message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    MockEventSource.instances[0]!.emit(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("swallows malformed JSON payloads without calling the callback or throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => MockEventSource.instances[0]!.emitRaw("not json{")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(() => {}));
    expect(() => MockEventSource.instances[0]!.emitError()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const instance = MockEventSource.instances[0]!;
    expect(instance.closed).toBe(false);
    unmount();
    expect(instance.closed).toBe(true);
  });

  it("always calls the latest callback without reopening the connection when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    // No new EventSource should be created when the callback identity changes.
    expect(MockEventSource.instances).toHaveLength(1);

    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    MockEventSource.instances[0]!.emit(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
