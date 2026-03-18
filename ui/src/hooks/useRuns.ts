import { useState, useEffect, useCallback } from "react";
import { api, type Run } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

export function useRuns(stateFilter?: string) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await api.getRuns(stateFilter);
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.type === "run:created") {
        void fetchRuns();
      } else if (event.type === "run:state-changed") {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === event.runId ? { ...r, state: event.to as string } : r,
          ),
        );
      }
    },
    [fetchRuns],
  );

  useSSE(handleSSE);

  return { runs, loading, error, refetch: fetchRuns };
}
