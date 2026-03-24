import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ActiveProcess } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

interface UseActiveProcessesResult {
  processes: ActiveProcess[];
  hasActive: boolean;
  output: string;
  activeProcessId: string | null;
}

export function useActiveProcesses(runId: string): UseActiveProcessesResult {
  const [processes, setProcesses] = useState<ActiveProcess[]>([]);
  const [output, setOutput] = useState("");
  const outputRef = useRef("");

  const fetchProcesses = useCallback(async () => {
    try {
      const result = await api.getActiveProcesses(runId);
      setProcesses(result.processes);

      if (result.processes.length > 0) {
        const proc = result.processes[0]!;
        try {
          const outputResult = await api.getProcessOutput(proc.id);
          outputRef.current = outputResult.output;
          setOutput(outputResult.output);
        } catch {
          // process may have just ended
        }
      }
    } catch {
      // server may be restarting
    }
  }, [runId]);

  useEffect(() => {
    void fetchProcesses();
  }, [fetchProcesses]);

  useEffect(() => {
    if (processes.length === 0) return;
    const interval = setInterval(() => void fetchProcesses(), 2_000);
    return () => clearInterval(interval);
  }, [processes.length, fetchProcesses]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.runId !== runId) return;

      if (event.type === "process:started" || event.type === "process:completed") {
        void fetchProcesses();
      }

      if (event.type === "process:output" && event.chunk) {
        outputRef.current += event.chunk;
        if (outputRef.current.length > 8192) {
          outputRef.current = outputRef.current.slice(-8192);
        }
        setOutput(outputRef.current);
      }
    },
    [runId, fetchProcesses],
  );

  useSSE(handleSSE);

  const activeProcessId = processes.length > 0 ? processes[0]!.id : null;

  return {
    processes,
    hasActive: processes.length > 0,
    output,
    activeProcessId,
  };
}
