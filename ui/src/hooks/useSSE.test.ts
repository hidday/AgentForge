import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

// jsdom does not implement EventSource, so we provide a minimal fake that
// records instances and lets tests drive onmessage/onerror manually.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
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

  it("connects to the events stream endpoint on mount", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
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

  it("does not throw when the underlying source errors", () => {
    renderHook(() => useSSE(vi.fn()));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!(new Event("error"))).not.toThrow();
  });

  it("always calls the latest callback without reconnecting on re-render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    // Still only one EventSource — the effect that creates it has an empty
    // dependency array, so it should not reconnect on every render.
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));

    const source = FakeEventSource.instances[0]!;
    expect(source.close).not.toHaveBeenCalled();

    unmount();

    expect(source.close).toHaveBeenCalledOnce();
  });
});
