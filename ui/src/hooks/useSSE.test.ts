import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }

  emitError() {
    this.onerror?.();
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

  it("opens an EventSource connection to /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on a valid message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    MockEventSource.instances[0]!.emitMessage(event);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores a message whose data is not valid JSON", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => MockEventSource.instances[0]!.emitMessage("not json")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(() => MockEventSource.instances[0]!.emitError()).not.toThrow();
  });

  it("always calls the latest callback even after a re-render with a new function identity", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    MockEventSource.instances[0]!.emitMessage(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("does not open a second EventSource connection across re-renders", () => {
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;

    unmount();

    expect(instance.close).toHaveBeenCalledTimes(1);
  });
});
