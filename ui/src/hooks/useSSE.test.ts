import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource connection to /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    act(() => {
      source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed event payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onmessage!({ data: "not-json" } as MessageEvent);
      });
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => {
      act(() => {
        source.onerror!();
      });
    }).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("does not reopen the connection when the callback identity changes across renders", () => {
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("always calls the latest callback even after a rerender changed it", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    act(() => {
      source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
