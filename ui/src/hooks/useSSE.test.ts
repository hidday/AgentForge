import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("opens an EventSource pointed at the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and invokes the callback with the event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed message payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source errors", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("does not re-open the EventSource when the callback identity changes across renders", () => {
    const first = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), { initialProps: { cb: first } });
    expect(FakeEventSource.instances).toHaveLength(1);

    const second = vi.fn();
    rerender({ cb: second });
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
