import { useState, useEffect, useCallback } from "react";
import { api, type RunSkillsResponse } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

export function useRunSkills(runId: string) {
  const [data, setData] = useState<RunSkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const result = await api.getRunSkills(runId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch run skills");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.runId !== runId) return;
      if (event.type === "run:state-changed" || event.type === "run:artifact-created") {
        void fetchSkills();
      }
    },
    [runId, fetchSkills],
  );

  useSSE(handleSSE);

  return { data, loading, error, refetch: fetchSkills };
}
