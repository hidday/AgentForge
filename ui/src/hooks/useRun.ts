import { useState, useEffect, useCallback } from "react";
import { api, type Run, type Artifact, type RunEventRecord } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

interface RunDetail {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

export function useRun(runId: string) {
  const [data, setData] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      const result = await api.getRun(runId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.runId !== runId) return;
      void fetchRun();
    },
    [runId, fetchRun],
  );

  useSSE(handleSSE);

  return { data, loading, error, refetch: fetchRun };
}
