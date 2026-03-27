import { useEffect, useRef } from "react";

export interface DashboardEvent {
  type:
    | "run:state-changed"
    | "run:artifact-created"
    | "run:created"
    | "process:started"
    | "process:output"
    | "process:completed";
  runId: string;
  processId?: string;
  chunk?: string;
  [key: string]: unknown;
}

export function useSSE(onEvent: (event: DashboardEvent) => void): void {
  const callbackRef = useRef(onEvent);
  useEffect(() => {
    callbackRef.current = onEvent;
  });

  useEffect(() => {
    const source = new EventSource("/api/events/stream");

    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as DashboardEvent;
        callbackRef.current(event);
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects on error
    };

    return () => source.close();
  }, []);
}
